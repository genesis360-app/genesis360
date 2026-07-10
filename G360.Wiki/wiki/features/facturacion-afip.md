---
title: Facturación Electrónica AFIP
category: features
tags: [afip, facturacion, cae, iva, argentina, fiscal, pdf, qr]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-07-09
---

# Facturación Electrónica AFIP

Módulo de facturación electrónica conforme a RG 5616 AFIP. Implementado en v1.3.0 PROD ✅.  
**PDF con QR AFIP implementado en v1.5.0 PROD ✅** (RG 4291 — obligatorio desde 2021).

> **v1.80.0 (EN DEV, 2026-06-19) — FAC-27:** guard server-side en la EF `emitir-factura` para **Factura B ≥ umbral sin DNI/CUIT** → responde **400** antes de llamar a AFIP (espeja `requiereIdentFacturaB` del POS; consistente con el guard de tipo A/B/C de v1.78.1). EF deployada a **DEV (v13)**; **pendiente PROD** (cambio fiscal). Comportamiento esperado por condición del emisor (RI/Monotributista/Exento) documentado y testeable en `tests/specs/uat-modo-basico.md` **§29 (matriz fiscal)**.

> [!NOTE] Homologación confirmada: CAE `86170057489609` emitido exitosamente (Factura B, CUIT de prueba `20409378472`).

---

## Decisión técnica

> ### ⚠ Cómo está implementado HOY (verificado 2026-06-30) — NO es WSFE directo
> A pesar del título "sin intermediario" de abajo (que fue la **intención**), lo deployado **usa AfipSDK (su nube), no una integración directa al WSFE**. En `emitir-factura`: `import Afip from 'npm:@afipsdk/afip.js'`, el `tenant.afipsdk_token` es **obligatorio** (línea 74), el CAE se pide con `eb.createVoucher()` (método de AfipSDK) y la firma WSAA se hace "en su nube". Verificado: **cero** rastro de WSFE directo en el repo (`wsaa.afip`/`servicios1.afip`/`wsfev1`/`FECAESolicitar`/`LoginCms`). El cert del tenant se pasa a AfipSDK pero el request **pasa por ellos**. **Costo:** AFIP/ARCA = $0; AfipSDK = free tier + pago por volumen, token **por tenant** (si cada cliente trae su cuenta, el costo es del cliente).

> ### 🎯 Estrategia de migración: DUAL-PROVIDER con rollback (decisión GO 2026-07-01)
> **✅ Fase 3 IMPLEMENTADA Y VALIDADA EN DEV (2026-07-09, v1.124.0, mig 264):** `WsfePropioProvider` REAL —
> TRA firmado CMS/PKCS#7 con el cert del tenant (`node-forge`, SHA-256) → WSAA `LoginCms` → **TA cacheado en
> la tabla `afip_wsaa_ta`** (mig 264, service_role-only; clave `(cuit, service, environment)` — AFIP no
> re-emite TA vigente, `coe.alreadyAuthenticated`) → WSFEv1 SOAP directo (`FECompUltimoAutorizado` /
> `FECAESolicitar`). Archivos: `emitir-factura/wsfe-core.ts` (núcleo PURO sin deps: builders/parsers XML en el
> **orden exacto del XSD** — ⚠ `ImpTrib` va ANTES de `ImpIVA`; testeado por vitest SIN espejo, importa el
> módulo real) + `wsfe-sign.ts` (firma CMS con forge inyectado, compartida Deno/Node) + `providers.ts`.
> **Validación completa contra homologación REAL:** 26 unit + integración Node
> (`tests/integration/wsfe-homologacion.ts`: FEDummy+WSAA+B+C+NC-C con CAE) + runtime vía EF en DEV
> (Factura B CAE `86280547716423` y C `86280547717526` por 'propio'; regresión afipsdk CAE `86280547717673`;
> **alternancia de numeración probada: B №25 propio→26 propio→27 afipsdk sin saltos**). UAT §32.
> `emitir-factura` v19 + `emitir-factura-plataforma` v2 deployadas a **DEV** (la de plataforma también acepta
> biller en 'propio': token AfipSDK ya no es requisito de ese circuito, cert sí).
> **⚠ Gotcha flip-day:** el TA es POR CERTIFICADO — si AfipSDK cloud tiene TA vigente del mismo cert, el
> primer login propio da `alreadyAuthenticated` hasta que expire (≤12h).
> **Falta para PROD:** mig 264 + deploy de ambas EFs (OK de GO) → tenant piloto → validar estabilidad → decidir retiro de AfipSDK.
> *(Fase 1 — adapter + flag, mig 250 — implementada 2026-07-01; mig 250 ya está en PROD desde v1.123.0, la EF de PROD sigue en la versión pre-adapter.)*
> GO decidió **construir el WSFE propio SIN romper AfipSDK y mantener AMBOS** (no big-bang), con vuelta atrás si el propio falla, hasta validar estabilidad. Diseño:
> - **Adapter/provider:** interfaz común (`emitirComprobante`/`ultimoAutorizado`/`emitirNC`) con `AfipSdkProvider` (actual) + `WsfePropioProvider` (nuevo: TRA + firma CMS/PKCS#7 → WSAA `LoginCms` → TA cacheado ~12h → WSFEv1 SOAP `FECAESolicitar`/`FECompUltimoAutorizado`). **La lógica fiscal (payload A/B/C, alícuotas, condición IVA receptor, `ImpTotal`) se comparte** — solo cambia el transporte, así REGLA #0 no se bifurca.
> - **Selector `tenants.afip_provider` (`'afipsdk'|'propio'`)** — mismo patrón que `afip_produccion` (mig 210): migración por-tenant + rollback instantáneo (flip de flag, sin deploy). Guardar `afip_provider_usado` en el comprobante.
> - **Numeración:** ambos piden el próximo número a `FECompUltimoAutorizado` de AFIP (no contador local) → se alternan sin saltear/duplicar.
> - **🛑 NO fallback automático en la EMISIÓN** (el propio pudo haber obtenido CAE aunque la respuesta falle → duplicado/salto de número). Rollback manual; reconciliar con `FECompUltimoAutorizado` ante error dudoso. Auto-fallback solo en lecturas.
> - **Fases:** homologación (reusar matriz A/B/C) → tenant piloto PROD → validar estabilidad → decidir si se saca AfipSDK. **Backlog** en `sources/raw/project_pendientes.md`. Ver [[reference_pricing_planes_costos]].
>
> **Nota sobre mantenimiento por cambios de ARCA:** es **simétrico** entre ambas opciones. WSAA/WSFEv1 (el transporte que tapa AfipSDK) es muy estable (sin cambios que rompan desde ~2012); lo que sí obliga a tocar código son **reglas fiscales** (campos obligatorios nuevos, leyendas, alícuotas) que pegan **igual** con o sin SDK. Frecuencia baja (un puñado/año, anunciados), complejidad baja. No requiere personal dedicado a vigilar ARCA — solo suscribirse a novedades de WS de AFIP + probar en homologación.

**Integración propia con AFIP WSFE** *(← INTENCIÓN documentada; hoy usa AfipSDK, ver nota de arriba)*:
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

7. **Guard fiscal (2026-06-18):** valida que el `tipo_comprobante` sea válido para `condicion_iva_emisor` — Monotributista/Exento → solo C; RI → nunca C; si no, **400**. Es la última línea de defensa: la restricción del selector en el front es solo UI y puede estar cacheada/bypasseada.

**Deploy de la EF:** `npx supabase functions deploy emitir-factura --project-ref <ref>` (CLI lee el archivo local, preserva config; más limpio que el MCP). DEV `gcmhzdedrkmmzfzfveig` · PROD `jjffnbrdjchquexdfgwq` (PROD requiere autorización explícita).

### ⚠ Gotcha — normalización de alícuota (numeric de Postgres) [2026-06-18]

`productos.alicuota_iva` / `venta_items.alicuota_iva` son `numeric` → supabase-js los devuelve como **string con decimales fijos**: `"21.00"`, `"10.50"`, `"0.00"`, `"27.00"`. El mapa `ALICUOTA_ID` tiene claves **sin** esos ceros (`"21"`, `"10.5"`, `"0"`, `"27"`). Hay que **normalizar la clave con `String(parseFloat(tasaStr))`** antes del lookup (excepto los literales `'exento'`/`'sin_iva'`). Si no, el lookup falla y cae al default `Id:5` (=21%) → para A/B con alícuota ≠ 21 el *importe* va a la tasa real pero el *Id* va como 21% → **AFIP rechaza (error 10051)**. Bug latente arreglado en `emitir-factura/index.ts` + espejo `facturacionLogic.ts` (unit FAC-IVA-08/09/10). El `<select>` de alícuota en `ProductoFormPage` requiere la misma normalización al cargar (si no, muestra el campo en blanco al editar), y al guardar NO usar `||21` (convierte Exento `0`→21).

---

## Notas de Crédito (NC) — flujo y gotchas (v1.70.0–v1.71.0)

**El único camino para emitir una NC es: abrir la venta facturada → "Devolver" (total o parcial) → en la devolución, botón "Emitir NC".** No hay "NC manual" suelta: una NC siempre reversa un comprobante puntual y queda atada a una `devoluciones` (`devolucion_id`). La EF toma los ítems de la devolución (no de la venta).

> [!WARNING] La emisión de NC **nunca había funcionado end-to-end** hasta v1.71.0 (solo se habían probado facturas). Dos bugs encadenados:
> - **El SELECT de la venta no traía `cae`** → la EF veía `venta.cae` undefined → "La venta no tiene factura emitida. No se puede emitir NC sin CAE original". Fix v1.70.0: `+cae, tipo_comprobante, numero_comprobante`.
> - **Falta `CbtesAsoc`** → AFIP rechaza con **error 10197** ("Si el comprobante es Débito o Crédito, enviar CbteAsoc o PeriodoAsoc"). Fix v1.71.0: `CbtesAsoc:[{ Tipo (del original), PtoVta (mismo PV), Nro (`numero_comprobante`) }]`. **Asume mismo PV que la NC** (caso single-PV; si el tenant usa otro PV para NC, guardar el PV de la factura original).

**Anular vs Devolver una facturada:** una venta **con CAE** no se puede "Anular" (los botones Anular + Cambiar cliente se **ocultan** si `ventaDetalle.cae`) — la reversión correcta es Devolver → NC. Anularla dejaría la factura viva en AFIP (libros descuadrados).

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
| Modo de emisión por-tenant | `tenants.afip_produccion` (homologación↔producción) | ✅ PROD v1.60.0 |
| Certificado propio por tenant | EF lee `.crt`/`.key` del bucket → AfipSDK constructor | ✅ PROD v1.60.0 |
| Factura C sin IVA (Monotributista) | `calcularImportes` (ImpIVA 0, sin array Iva) + PDF sin columnas IVA | ✅ PROD v1.60.0 |
| Auto-facturada al emitir | venta `despachada` → `facturada` al obtener CAE | ✅ PROD v1.60.0 |
| Acciones descargar / imprimir / email | POS post-emisión + detalle + historial; imprimir vía iframe; email con PDF adjunto | ✅ PROD v1.60.0 |
| Email con correo del cliente precargado | modal (reemplaza `window.prompt`) con `clientes.email` editable; en Ventas + Facturación | ✅ PROD v1.60.1 |
| Emitir desde el detalle | botón "Emitir factura" si la venta despachada no tiene CAE | ✅ PROD v1.60.0 |
| Tests de la lógica pura | `facturacionLogic.ts` + 28 unit tests + e2e mutante | ✅ PROD v1.60.0 |

> **v1.60.1** — UX: el envío por email abre un **modal con el correo del cliente precargado y editable** (busca `clientes.email` de la venta) en vez del prompt del navegador, tanto en **Ventas** (modal post-emisión + detalle/historial) como en el módulo **Facturación**. Y en el **PDF**, el bloque "FACTURA / N° / Fecha" quedó **alineado al margen derecho** (`facturasPDF.ts`, `{ align: 'right' }`).

> **v1.63.0** — **QR de pago MercadoPago en la factura** (cierra paridad Xubio). Si la factura tiene saldo pendiente (`total − monto_pagado > 0`) y el tenant tiene MP conectado, `facturasPDF` embebe un QR "Pagá con MercadoPago — saldo $X" en el pie (reusa EF `mp-crear-link-pago` + `mercadopago_credentials`; `external_reference = venta_id` → `mp-webhook` concilia). Graceful: sin MP o factura paga → sin QR. **Plan de paridad Xubio COMPLETO.**

> **v1.62.0** — **Comprobantes al nivel Xubio + extras** (mig 212). **Presupuesto PDF A4 nuevo** (`presupuestoPDF.ts`, antes solo ticket). **Factura completa** (`facturasPDF.ts`): IIBB + Inicio Act + contacto, N° con letra (A-0001-…), moneda, forma de pago (de `medio_pago`), domicilio receptor, columna Cód. (SKU), **Régimen de Transparencia Fiscal Ley 27.743 en Factura B** (IVA contenido), "Comprobante Autorizado" + datos para transferencia (CBU/Alias/Banco) + leyenda en el pie. **Remito** nuevo (`remitoPDF.ts`, no fiscal, "Recibí conforme"). Config → Facturación: sección "Datos para los comprobantes". Observaciones del comprobante = `ventas.notas`. Pendiente: link/QR de pago MercadoPago (integración de pagos, deploy dedicado).

> **v1.61.0** — **Logo del negocio en la factura** (paridad Xubio, fase 1). Mig 211 = bucket `logos` (público, scopeado por tenant). Config → Facturación sube/quita el logo (`tenants.logo_url`, ya existía); `facturasPDF.cargarLogo` lo embebe arriba a la izq (canvas→dataURL, conserva aspecto, el emisor se corre con `emX`). **Filename** con nombre del cliente. Próximas fases (paridad Xubio): emisor IIBB/Inicio Act + **Transparencia Fiscal Ley 27.743 (B)** + moneda/forma de pago/fecha vto + SKU + desglose IVA + "Comprobante Autorizado" (v1.62.0); **presupuesto PDF A4** (v1.63.0); detalle por línea obs/% dto (v1.64.0). Ver `project_pendientes.md` → "▶ PARIDAD XUBIO".

> **v1.60.2** — **Bloqueo de Factura A sin CUIT en el POS:** el botón "Factura A" se deshabilita cuando la venta no tiene cliente con CUIT (Responsable Inscripto) + aviso; si quedaba seleccionada, degrada a B. La EF ya lo rechazaba (`Para Factura A se requiere CUIT del cliente`, [emitir-factura/index.ts:135](../../../supabase/functions/emitir-factura/index.ts)), pero ahora no se llega a intentar. Además, **el error de emisión muestra el motivo real** (lee `error.context.json()` en POS/NC/Facturación) en vez de "Edge Function returned a non-2xx status code". Recordatorio AFIP: Factura A es solo entre Responsables Inscriptos (receptor con CUIT); a Consumidor Final solo B (o C si el emisor es Monotributista). `CbteFch` es **date-only** → el comprobante no lleva hora.

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

## Runbook — onboarding AFIP (homologación → producción)

Modelo = **AfipSDK cloud + certificado propio del tenant**. El tenant genera su
certificado (en AFIP/ARCA o con el asistente de AfipSDK), lo **sube en Config →
Facturación → Certificados AFIP**, y la EF lo lee del bucket y se lo pasa a AfipSDK por
constructor (`cert`/`key`). AfipSDK resuelve la firma WSAA en su nube (por eso funciona
en Deno Edge). El `access_token` identifica la cuenta de AfipSDK. Verificado el
2026-06-13 con un cert de homologación real (CUIT 23-32031506-9 → CAE C #1).

**Datos fiscales** (Config → Facturación): CUIT, condición IVA emisor (Monotributista→C,
RI→A/B), razón social, domicilio, **Token AfipSDK**, ≥1 **Punto de venta** que coincida
con AFIP. + subir **Certificado (.crt)** y **Clave privada (.key)** → debe quedar ✅ Activo.

**Probar en homologación (sin valor fiscal):** cert de homologación + `afip_produccion=false`
(banda "Modo de emisión" en HOMOLOGACIÓN). Vender → "¿Facturar ahora?" → emitir → CAE de
prueba. El log de la EF muestra `[homologación]`.

**Pasar a producción (CAE fiscal real):**
1. **CUIT activo** habilitado para WS `wsfe` en AFIP/ARCA.
2. **Certificado de PRODUCCIÓN** (issuer "AC Raíz/Computadores de la AFIP", no "Test")
   generado en AFIP + delegado en **Administrador de Relaciones** al servicio
   Facturación Electrónica → subirlo en Config (reemplaza el de homologación).
3. **Token AfipSDK de producción** (plan pago; homologación es gratis).
4. Banda **Modo de emisión** → **PRODUCCIÓN** (confirmar checkbox).
5. **Smoke real:** emitir un comprobante de monto chico → verificar CAE en el PDF y en
   "Mis Comprobantes" de AFIP. El log de la EF muestra `[PRODUCCIÓN]`.

---

## Decisión técnica: modelo de integración con AFIP

**Modelo adoptado = AfipSDK cloud + certificado propio del tenant (híbrido).** Es lo
mejor de los dos mundos y responde al comentario "usá afip.js con tu .key/.crt":

- Cada tenant **genera su propio certificado** (en AFIP/ARCA o con el asistente de
  AfipSDK) y lo **sube en Config → Facturación** (`tenant_certificates` + bucket
  `certificados-afip`, mig 043). La EF lo baja del bucket y lo pasa a AfipSDK por
  constructor (`cert`/`key`) — verificado: AfipSDK acepta cert+key directo.
- **AfipSDK** (`@afipsdk/afip.js` con `access_token`) resuelve la firma WSAA (CMS/PKCS7
  del ticket + cache del TA) en su nube. Por eso funciona en **Deno Edge**, donde firmar
  localmente sería impráctico (cripto limitada).
- **Ventaja:** el cliente controla su certificado (no depende de que esté cargado en el
  dashboard de AfipSDK), per-tenant, y AfipSDK solo hace la parte criptográfica.

**Alternativa self-host puro** (sin AfipSDK, firma local directa a ARCA): exigiría
implementar WSAA+WSFE y mover la EF a un runtime Node/microservicio — proyecto dedicado,
solo si a futuro se quiere sacar el tercero del camino.

> El uploader de certificados `.crt`/`.key` de Config (que antes era código muerto)
> quedó **cableado a la EF en v1.60.0** — ya no es trampa, es el mecanismo oficial.

### Factura C (Monotributista) — sin discriminar IVA

La EF detecta C / NC-C (`tipo_comprobante`) y emite con `ImpNeto = ImpTotal`, `ImpIVA = 0`
y **sin array `Iva`** (AFIP rechaza una C que lleve IVA/alícuotas). A/B siguen
discriminando por alícuota. Cubierto por `calcularImportes` + tests.

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
