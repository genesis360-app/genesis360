---
title: Roadmap y Versiones
category: business
tags: [roadmap, versiones, releases, pendiente, prod]
sources: [ROADMAP.md, WORKFLOW.md]
updated: 2026-04-30
---

# Roadmap y Versiones

**Versión actual en PROD:** v1.6.1  
**Última actualización:** 6 de Mayo, 2026

---

## Estado v1.6.1 — En PROD ✅ (migrations 086 + 086b)

### Security hardening (migrations 086 + 086b)
- `REVOKE EXECUTE FROM PUBLIC` en funciones de trigger/internas (no llamables via REST `/rpc/`)
- `REVOKE FROM PUBLIC + GRANT TO authenticated` en funciones de negocio y auth helpers
- `SET search_path = public` en ~35 funciones (previene search_path injection)
- Buckets `avatares` + `productos`: policy SELECT restringida a `authenticated`
- **Resultado:** 80 → 7 warnings en Supabase Security Advisor (7 aceptados by design)

### Sentry
- `@sentry/react` en `src/main.tsx`
- `tracesSampleRate: 0.1` (10%) · `replaysOnErrorSampleRate: 1.0` (replay completo en errores)
- Variable `VITE_SENTRY_DSN` en Vercel Production

### OC — fixes v1.6.1
- Cantidad en ítems de OC respeta `unidad_medida`: enteros bloquean `.`/`,`; decimales usan `step=0.001`
- Botones **PDF** (jsPDF + autoTable) y **CSV** (BOM UTF-8) en modal detalle OC. Nombre: `OC_0001_Proveedor.pdf/.csv`

### npm audit: 21 → 7 vulnerabilidades
- Fixes seguros aplicados; `@typescript-eslint` actualizado. 7 restantes aceptados (dompurify/jsPDF, esbuild/Vite dev-only, xlsx sin fix disponible).

---

## Estado v1.6.0 — En PROD ✅ (migration 085)

### OC — Gestión de pagos (migration 085)
- `ordenes_compra`: +`estado_pago` (pendiente_pago / pago_parcial / pagada / cuenta_corriente) · +`monto_total` · +`monto_pagado` · +`fecha_vencimiento_pago` · +`dias_plazo_pago` · +`condiciones_pago`
- OC nuevas arrancan con `estado_pago = 'pendiente_pago'` por defecto

### Tab "Órdenes de Compra" en GastosPage
- Lista filtrable por estado_pago y proveedor
- Badge contextual: 🔴 vencida · ⏰ ≤ 3 días · estado normal
- Modal dos modos: **Registrar pago** (con egreso automático a caja) / **Cuenta Corriente** (plazo + condiciones)

### ProveedoresPage — bloqueo y CC Proveedores
- Botón Confirmar OC deshabilitado cuando `estado_pago = 'pendiente_pago'`
- Botón CreditCard por proveedor → modal CC: saldo adeudado, historial movimientos, pago inline
- `proveedores.cuenta_corriente_habilitada` + `limite_credito_proveedor`
- Tabla `proveedor_cc_movimientos` + `fn_saldo_proveedor_cc()` SECURITY DEFINER

### AlertasPage + useAlertas
- Sección roja "OC vencidas sin pagar" → botón Regularizar → /gastos
- Sección ámbar "OC por vencer en 3 días" → botón Pagar ahora → /gastos
- Badge sidebar incluye conteo de ambas secciones

---

## Estado v1.5.0 — En PROD ✅ (migration 084)

### Notificaciones reales (migration 084)
- Tabla `notificaciones` (tenant_id, user_id, tipo, titulo, mensaje, leida, action_url) — RLS user-only
- `NotificacionesButton` reescrito con datos reales, `refetchInterval: 30s`, marcar leída/todas
- `send-email` EF: nuevo tipo `notificacion` con `notificacionTemplate()`

### Módulo Caja — mejoras
- Diferencia de apertura: warning inline en tiempo real + confirmación 2-paso + notificación supervisores vía campana + email
- `getTipoDisplay()`: distingue "Ingreso Manual" vs "Venta" por patrón `#N` en concepto
- **Tab Caja Fuerte**: historial depósitos, `tenants.caja_fuerte_roles`, trigger auto-creación
- **Tab Configuración** (OWNER/SUPERVISOR): soft delete cajas, configurar roles acceso
- Historial sesiones: diferencia apertura y cierre por separado
- Nuevos campos `caja_sesiones`: `monto_sugerido_apertura` + `diferencia_apertura`

### PDF Factura con QR AFIP (RG 4291) ✅
- `src/lib/facturasPDF.ts`: layout A4 con emisor, receptor, ítems IVA desglosado, totales
- QR AFIP: JSON comprobante → base64 → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- Botón en FacturacionPage (historial emitidas) y VentasPage modal detalle (cuando `venta.cae !== null`)

### Cuenta Corriente Clientes — pago inline
- `registrarPagoCC()`: distribuye FIFO over ventas CC, acumula medio_pago JSON, marca despachada al saldo=0
- Panel inline en tab CC de ClientesPage

---

## Estado v1.4.0 — En PROD ✅

### Cuenta Corriente (migration 083)
- `clientes.cuenta_corriente_habilitada` + `limite_credito` + `plazo_pago_dias`
- `ventas.es_cuenta_corriente BOOLEAN`
- Tab "Cuenta Corriente" en ClientesPage: KPIs, deuda por cliente, botón WA, registrar pago
- VentasPage: botón "Despachar a cuenta corriente" (bypasa validación pago/caja)

### Presupuesto vencido
- `isPresupuestoVencido(venta, validezDias)`: compara `updated_at` vs `presupuesto_validez_dias`
- Badge "Vencido" en historial, banner naranja en modal
- Botón "Actualizar precios ahora": recalcula precios actuales de cada ítem

### Bulk actions en ProductosPage
- Checkboxes en filas + barra flotante (fixed bottom)
- Acciones: Categoría / Regla inventario / Aging profile / Atributos / Desactivar

### TN Stock Worker — mejora performance
- BATCH_SIZE 200, CONCURRENCY 20 paralelos
- Throughput: ~2.400 jobs/minuto (~15× más rápido)

---

## Estado v1.3.0 — En PROD ✅

### Facturación Electrónica AFIP (migrations 076-077)
- `FacturacionPage` 4 tabs: Panel KPIs · Facturación · Libros IVA · Liquidación
- EF `emitir-factura` con AfipSDK
- Homologación exitosa: CAE emitido en ambiente de prueba
- Prompt "¿Facturar ahora?" al despachar
- ~~PDF con QR AFIP~~ ✅ (completado en v1.5.0 — `src/lib/facturasPDF.ts`)
- Pendiente Fase 2: email automático al cliente · Notas de Crédito electrónicas

### Módulo Envíos (migration 075)
- `EnviosPage` con estados, remito PDF, WhatsApp Click-to-Chat
- Prerequisito: `cliente_domicilios` (migration 074)

### WhatsApp Click-to-Chat (migrations 078-079)
- `src/lib/whatsapp.ts` + configuración de plantilla en ConfigPage

### Clientes mejorado (migration 081)
- Notas, fecha_nacimiento, etiquetas, búsqueda por DNI

### Presupuestos servicios (migration 080)
- Estados + integración con Gastos

### GastosPage overhaul (migration 072)
- IVA, múltiples medios de pago, historial separado, fijos con alerta

### Proveedores/Servicios (migration 073)
- proveedor_productos, servicio_items, servicio_presupuestos + etiquetas

---

## Historial de versiones destacadas (PROD)

| Versión | Hito principal |
|---------|---------------|
| v0.26.0 | RRHH Phase 1 — empleados, puestos, departamentos |
| v0.27.0 | Caja ↔ Ventas ↔ Gastos integrados |
| v0.32.0 | RRHH Phase 2A — Nómina |
| v0.33.0 | RRHH Vacaciones + Asistencia |
| v0.34.0 | RRHH Documentos + Capacitaciones |
| v0.35.0 | RRHH Dashboard + Phase 5 Supervisor |
| v0.36.0 | Límites de movimientos por plan |
| v0.37.0 | Matriz de features por plan + UpgradePrompt |
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
| v0.76.0 | Módulo Proveedores completo + Órdenes de Compra |
| v0.83.0 | Conteo de inventario + Estructura LPN |
| v0.86.0 | Tab Autorizaciones DEPOSITO |
| v0.87.0 | Combinar LPNs + LPN Madre |
| v0.88.0 | Módulo Recepciones/ASN |
| v0.89.0 | Integraciones OAuth (TiendaNube + MercadoPago) |
| v0.90.0 | TN Webhooks + Sync stock + Monitoring diario |
| v1.0.0 | Stock reservation + pg_cron sync cada 5min |
| v1.1.0 | Importar maestros extendido + Config UX |
| v1.2.0–v1.3.0 | Facturación AFIP + Envíos + WhatsApp + Clientes mejorado |
| v1.4.0 | Cuenta Corriente clientes + Presupuesto vencido + Bulk actions |
| v1.5.0 | Notificaciones reales + Caja Fuerte + PDF Factura QR AFIP |
| v1.6.0 | OC gestión pagos + Cuenta Corriente proveedores |
| v1.6.1 | Security hardening (80→7 warnings) + Sentry + OC PDF/CSV |

---

## Pendientes / Backlog

### v1.7.0 — API pull (próxima versión planificada)
- [ ] EF `data-api`: GET /data-api?entity=productos|clientes|proveedores|inventario
- [ ] Migration 087: tabla `api_keys` (hash SHA-256, prefijo g360_, permisos TEXT[])
- [ ] Tab "API" en ConfigPage (OWNER/ADMIN): CRUD de keys + docs inline
- [ ] Botones Exportar JSON/CSV en ProductosPage, ClientesPage, ProveedoresPage
- [ ] Rate limiting 120 req/min por key (Map en memoria del isolate)

### Facturación (Fase 2)
- [x] ~~PDF factura con QR AFIP~~ ✅ v1.5.0
- [ ] Envío automático por email al cliente al emitir CAE
- [ ] Notas de Crédito electrónicas en devoluciones (NC-A/B/C)

### WMS (Fase 3)
- [ ] Tabla `wms_tareas`: putaway / picking / replenishment / conteo
- [ ] Listas de picking con ruta óptima
- [ ] Interface en InventarioPage o página WMS dedicada

### Envíos (Fase 2 — cuando haya contratos couriers)
- [ ] EF `courier-rates`: OCA / CorreoAR / Andreani / DHL en paralelo
- [ ] Label printing desde el courier

### Recepciones (ASN)
- [ ] RecepcionesPage completa (ya existe schema en migration 050+059)

### Revenue / Add-ons
- [ ] Add-on movimientos con pago automático MP (pendiente)

### Centro de Soporte / Ayuda
- [ ] Ruta `/ayuda` con FAQ, chat, guías interactivas, form bug-report

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
