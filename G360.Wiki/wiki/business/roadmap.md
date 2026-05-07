---
title: Roadmap y Versiones
category: business
tags: [roadmap, versiones, releases, pendiente, prod]
sources: [CLAUDE.md, ROADMAP.md, WORKFLOW.md, project_pendientes.md]
updated: 2026-05-07
---

# Roadmap y Versiones

**Versión en PROD:** ver `G360.Wiki/sources/raw/project_pendientes.md` (fuente de verdad)  
**Última actualización:** 7 de Mayo, 2026

---

## v1.8.1 — Módulo Recursos + estructura en ingreso + fixes (DEV, pendiente PROD)

### Módulo Recursos (migration 089)
- Nueva tabla `recursos` (patrimonio del negocio, no para vender). Estados: activo/en_reparacion/dado_de_baja/pendiente_adquisicion.
- `RecursosPage` 2 tabs: Patrimonio + Por adquirir. CRUD, stats, alertas garantía, CTA cotizar → /proveedores.
- Sidebar: ícono Landmark, ownerOnly, entre Prov./Servicios y Recepciones.

### Estructura de embalaje en ingreso de stock
- `InventarioPage` modal ingreso: select de estructura preseleccionado con la default del producto.
- `RecepcionesPage`: idem por cada ítem. Carga estructuras async al agregar producto (manual o desde OC).
- Guarda `estructura_id` en `inventario_lineas` en ambos flujos.

### Fixes
- Banner DEV: `h-4 text-[10px]` (~25% más fino) + `mt-4` en AppLayout → no solapa header/sidebar.
- ProveedoresPage: badge estado_pago en cards de OC (rojo/ámbar/azul/vencida).
- EnviosPage: botón WhatsApp fallaba — faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md reducido de ~1500 a ~120 líneas. Reglas de wiki obligatorias.

---

## v1.8.0 — NC electrónicas + email CAE + fixes OC (migration 088)

### Notas de Crédito electrónicas
- `devoluciones` + campos `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`, `nc_tipo CHECK(NC-A/NC-B/NC-C)`, `nc_punto_venta`
- EF `emitir-factura`: acepta `tipo_comprobante: NC-A|NC-B|NC-C` + `devolucion_id` → guarda CAE en `devoluciones`
- VentasPage: badge verde `NC-B #000001` + botón "Emitir NC" en sección devoluciones del modal

### Email al cliente al emitir CAE
- EF `send-email`: nuevo tipo `factura_emitida` con tabla ítems + badge CAE
- EF `emitir-factura`: fire-and-forget email post-CAE al cliente (solo facturas, no NC)

### GastosPage OC — fixes
- Medios de pago mixtos en OC: N filas + "+ Agregar medio", total en tiempo real, egreso de caja por cada Efectivo
- Fix CC: ya no valida monto, registra saldo como deuda automáticamente
- OC pagadas al fondo con sort + expand ítems

### ProveedoresPage — fix
- "Confirmar OC" solo habilitado con `estado_pago = 'pagada'` o `'cuenta_corriente'`. Con `pago_parcial` muestra tooltip bloqueado.

---

## v1.7.0 — API pull (migration 087)

- EF `data-api` (--no-verify-jwt): GET con `entity`, `format`, `limit`, `offset`, `updated_since`, `sucursal_id`. Entidades: productos/clientes/proveedores/inventario. Auth: X-API-Key. Rate 120 req/min.
- Migration 087: tabla `api_keys` (key_prefix, key_hash SHA-256, permisos TEXT[], activo, last_used_at). RLS tenant + OWNER/ADMIN.
- ConfigPage tab "API" (OWNER/ADMIN): generar key (plain text una sola vez), tabla prefijo + last_used_at, revocar, docs inline.
- Exportar JSON/CSV en ProductosPage, ClientesPage, ProveedoresPage (dropdown, BOM UTF-8).

---

## v1.6.1 — Security hardening + Sentry + OC PDF/CSV (migrations 086 + 086b)

### Security hardening
- `REVOKE EXECUTE FROM PUBLIC` en funciones de trigger/internas
- `REVOKE FROM PUBLIC + GRANT TO authenticated` en funciones de negocio y auth helpers
- `SET search_path = public` en ~35 funciones
- Buckets `avatares` + `productos`: policy SELECT restringida a `authenticated`
- **Resultado:** 80 → 7 warnings en Supabase Security Advisor (7 aceptados by design)

### Sentry
- `@sentry/react` en `src/main.tsx`, `tracesSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`
- Variable `VITE_SENTRY_DSN` en Vercel Production

### OC — fixes
- Cantidad en ítems respeta `unidad_medida`: enteros bloquean `.`/`,`; decimales `step=0.001`
- Botones PDF (jsPDF + autoTable) y CSV (BOM UTF-8) en modal detalle OC. Nombre: `OC_0001_Proveedor.pdf/.csv`

### npm audit: 21 → 7 vulnerabilidades

---

## v1.6.0 — OC gestión de pagos + CC Proveedores (migration 085)

- `ordenes_compra` + `estado_pago` (pendiente_pago/pago_parcial/pagada/cuenta_corriente) · monto_total · monto_pagado · fecha_vencimiento_pago
- Tab "Órdenes de Compra" en GastosPage: lista filtrable, badge rojo/ámbar por vencimiento, modal pago/CC
- ProveedoresPage: Confirmar OC deshabilitado con `pendiente_pago`, botón CreditCard por proveedor → modal CC
- Tabla `proveedor_cc_movimientos` + `fn_saldo_proveedor_cc()` SECURITY DEFINER
- AlertasPage: sección roja "OC vencidas sin pagar" + sección ámbar "OC por vencer en 3d"

---

## v1.5.0 — Notificaciones reales + Caja Fuerte + PDF Factura QR (migration 084)

- Tabla `notificaciones` real con RLS user-only. `NotificacionesButton` con datos reales.
- EF `send-email` tipo `notificacion`. Warning diferencia apertura → notifica supervisores.
- Tab Caja Fuerte + Tab Configuración en CajaPage. `getTipoDisplay()` distingue venta/manual.
- `src/lib/facturasPDF.ts`: PDF A4 con QR AFIP (RG 4291). `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- Pago CC inline: `registrarPagoCC()` FIFO sobre ventas CC.

---

## v1.4.0 — Cuenta Corriente + Presupuesto vencido + Bulk actions (migration 083)

- `clientes.cuenta_corriente_habilitada` + `limite_credito` + `plazo_pago_dias`; `ventas.es_cuenta_corriente`
- Tab "CC" en ClientesPage: KPIs, deuda, botón WA, registrar pago
- VentasPage: botón "Despachar a cuenta corriente" (bypasa validación pago/caja)
- `isPresupuestoVencido()`: badge "Vencido" + banner en modal + "Actualizar precios ahora"
- Bulk actions en ProductosPage: checkboxes + barra flotante (categoría/regla/aging/atributos/desactivar)
- TN Stock Worker: BATCH_SIZE 200, CONCURRENCY 20 → ~2.400 jobs/min

---

## v1.3.0 — Facturación AFIP + Envíos + WhatsApp (migrations 072–081)

- `FacturacionPage` 4 tabs: Panel · Facturación · Libros IVA · Liquidación. EF `emitir-factura` con AfipSDK. Homologación exitosa.
- `EnviosPage` con estados, remito PDF, WhatsApp Click-to-Chat. Prerequisito: `cliente_domicilios` (migration 074).
- `src/lib/whatsapp.ts`: normalización, plantilla configurable, `$ por km`.
- Clientes: notas (append-only), fecha_nacimiento, etiquetas, búsqueda por DNI.
- GastosPage overhaul: IVA, múltiples medios, historial separado, fijos con alerta.
- Proveedores: `proveedor_productos`, `servicio_items`, `servicio_presupuestos`.

---

## Historial comprimido (antes de v1.3.0)

| Versión | Hito principal |
|---------|---------------|
| v0.26.0 | RRHH Phase 1 — empleados, puestos, departamentos |
| v0.27.0 | Caja ↔ Ventas ↔ Gastos integrados |
| v0.32.0 | RRHH Phase 2A — Nómina |
| v0.33.0 | RRHH Vacaciones + Asistencia |
| v0.34.0 | RRHH Documentos + Capacitaciones |
| v0.35.0 | RRHH Dashboard + Phase 5 Supervisor |
| v0.36.0 | Límites de movimientos por plan |
| v0.37.0 | Matriz de features + UpgradePrompt |
| v0.42.0 | Multi-sucursal |
| v0.47.0 | Scanner reescrito (BarcodeDetector + ZBar WASM) |
| v0.51.0 | Scanner definitivo + Completar desde foto (Claude Haiku) |
| v0.57.0 | WMS Fase 1 (estructuras) + Ingreso/Rebaje masivo |
| v0.58.0 | Devoluciones |
| v0.63.0 | Mi Cuenta + restricciones menú por rol |
| v0.65.0 | KITs/Kitting WMS Fase 2.5 |
| v0.68.0 | IVA por producto + Design System Sprint 1+2 |
| v0.69.0 | Dashboard rediseño + FilterBar + La Balanza + Mix de Caja |
| v0.72.0 | Roles CONTADOR + DEPOSITO |
| v0.76.0 | Módulo Proveedores + Órdenes de Compra |
| v0.83.0 | Conteo de inventario + Estructura LPN |
| v0.86.0 | Tab Autorizaciones DEPOSITO |
| v0.87.0 | Combinar LPNs + LPN Madre |
| v0.88.0 | Módulo Recepciones/ASN |
| v0.89.0 | Integraciones OAuth (TiendaNube + MercadoPago) |
| v0.90.0 | TN Webhooks + Sync stock + Monitoring diario |
| v1.0.0 | Stock reservation + pg_cron sync 5min |
| v1.1.0 | Importar maestros extendido + Config UX |
| v1.2.0 | Clientes mejorado (dominios, etiquetas) |

---

## Pendientes / Backlog

> Estado real de PROD/DEV → ver `G360.Wiki/sources/raw/project_pendientes.md`

### Media prioridad
- **Notificación automática CC vencida** — pg_cron diario → INSERT `notificaciones` para clientes/OC vencidas sin pagar
- **OC → Gasto automático** al confirmar recepción en RecepcionesPage
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report

### Backlog técnico
- **WMS Fase 3** — `wms_tareas` (putaway/picking/replenishment) + listas de picking con ruta óptima
- **RecepcionesPage completa** — schema existe (migrations 050+059), falta flujo UI completo
- **Sync catálogo TN/ML** — push nombre/precio/descripción hacia marketplaces
- **Courier rates APIs** — OCA/Andreani/CorreoAR reales
- **WhatsApp automático** — espera WABA account

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)

### Ideas futuras
- Cupones de descuento
- WhatsApp diario automático
- IA chat integrado
- Benchmark por rubro
- Multilenguaje

---

## Links relacionados

- [[wiki/business/modelo-negocio]]
- [[wiki/business/planes-pricing]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/wms]]
- [[wiki/features/envios]]
- [[wiki/features/clientes-proveedores]]
