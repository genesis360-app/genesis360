# Índice del Wiki — Genesis360

Catálogo completo de páginas. Actualizar en cada ingest, query guardado, o modificación.

---

## Overview

| Página                                | Descripción                                          | Estado |
| ------------------------------------- | ---------------------------------------------------- | ------ |
| [[wiki/overview/genesis360-overview]] | Visión general v1.8.27-prod / v1.8.31-dev, stack, módulos, estado actual | ✅      |

---

## Features

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/features/autenticacion-onboarding]] | Google OAuth, roles, trial · fix registro · defaults seed (Sucursal 1 + Caja + motivos + estados) | ✅ |
| [[wiki/features/productos]] | ProductosPage + ProductoFormPage · scan ticket IA (v1.8.38) · 6 cards · marca/UdM/variantes/shelf life · grupos · ubicación por sucursal · inactivos visibles | ✅ |
| [[wiki/features/inventario-stock]] | LPNs, FIFO/FEFO, stock sucursal, bulk edit · **Conteos 2.0 cerrado 100%** (scope marca/wall-to-wall · modos+ciego · gate+autorizaciones+delta · scan-to-count + fuera-de-alcance · ABC+cíclico+reportes+trazabilidad · doble conteo formal · wall-to-wall bloqueante) · rebaje masivo fix · shortcuts ESC/ENTER · filtros pill · modales inline | ✅ |
| [[wiki/features/ventas-pos]] | Carrito · 3 modos · CC parcial · cuotas · ticket por sucursal · envío + Haversine · multi-sucursal estricto · **reservas** seña/vencimiento+liberación/penalidad+crédito a favor+redención (mig 160) · **presupuestos** `PRES-NNNN` (mig 159) · **mayorista por cantidad** + costo/margen por rol · **descuentos solo DUEÑO/SUPERVISOR/ADMIN** (G3) · **precio USD** convertido en POS (mig 161) | ✅ |
| [[wiki/features/caja]] | Sesiones, traspasos, arqueos, multi-caja · caja predeterminada ★ · cajas.sucursal_id · Caja Principal en seed · **v1.9.1**: cajas por moneda + Cuentas de Origen + bóveda discriminada + sin egreso manual + arqueo pre-cierre obligatorio · **v1.9.2**: bóveda como billetera del negocio + botón Extraer dinero (solo DUEÑO) + historial privado · **v1.9.3**: Fase 2.0 — permisos J3 + CONTADOR read-only + abrir a nombre de cajero (A2) + clave maestra solo DUEÑO (B6) + clave maestra al cerrar ajena (B5) + mail al DUEÑO al cierre (C2) + banner caja olvidada 24h (A4) · **v1.9.4**: Fase 2.1 — numeración correlativa por sucursal (K3) + snapshot completo del cierre (K2) + ticket PDF ampliado A4 / Térmico 80mm (C1+C3) + umbral diferencia + alertas multi-canal configurables (B1/B2/B3) + movimiento "Diferencia caja" asociado al cajero (B4) + reporte diferencias por cajero 30d · **v1.9.5**: Fase 2.2a — bloqueo cambio sucursal con caja abierta (L4) + selector caja en devolución efectivo (L1) + cadena anulación según estado (L5) + botón "Corregir" en movimientos manuales con audit log (G1) + doble validación al cierre con 2do usuario (B7) · **v1.10.0 HITO**: Reportes Caja con 4 vistas (diario por caja / consolidado / mensual por sucursal / por cajero) + 3 exports (Excel/PDF/CSV) (I1/I2) · **v1.10.2**: sin PDF automático al cerrar (manual desde historial) | ✅ |
| [[wiki/features/gastos]] | Variables, fijos, IVA, OC · efectivo en caja · CC en OC · **v1.8.42**: categorías predefinidas + custom · reglas comprobante · indicadores fijos · badge anticipo OC · **v1.8.43**: umbrales por rol/sucursal + bandeja autorizaciones · **v1.8.44**: IVA auto + selector alícuota + sucursal obligatoria por categoría + bloqueo CC proveedor + override DUEÑO · **v1.8.45**: capitalización en recursos + vw_egresos_consolidados · **v1.9.0**: cierre contable mensual (HITO) + notas de corrección · **v1.10.2**: selector caja filtra por sucursal activa | ✅ |
| [[wiki/features/devoluciones]] | Stock serializado/no-serializado, NC, caja | ✅ |
| [[wiki/features/clientes-proveedores]] | CRM, CC, OC, domicilios · **Clientes CL1–CL6 completo** (soft delete, import 3 modos, CC límite/vencimiento/interés/morosidad/cobranza, incobrables, estado de cuenta PDF/portal, notificaciones, reportes/aging/export, audit) · **Compras 2.0 CO1-CO5** (gobierno OC: rol/umbral/aprobación/numeración/pago · recepción robusta: acumulado por OC/over-under/remito · costos: alerta cambio/accesorios/alta producto · devolución a proveedor: crédito CC/efectivo/reposición · **CO5 pago: modo por proveedor + anticipo + schedule + comprobante transferencia**) · proveedores: cuentas bancarias múltiples | ✅ |
| [[wiki/features/facturacion-afip]] | AFIP WSFE, tipos A/B/C, AfipSDK, FacturacionPage 4 tabs | ✅ DEV |
| [[wiki/features/rrhh]] | 5 fases: empleados, nómina, vacaciones, asistencia, supervisor · **RRHH-A5** (mig 151): selector "Usuario del sistema" en form empleado + columna Usuario en tabla, habilita "Mi Equipo" del SUPERVISOR | ✅ |
| [[wiki/features/wms]] | Estructuras, ubicaciones, KITs, kitting, conteos, recepciones · scan ticket en RecepcionesPage (v1.8.38) | ✅ |
| [[wiki/features/marketplace]] | API pública, webhook saliente, publicación por producto | ✅ |
| [[wiki/features/envios]] | Propio + Courier · POD (foto cámara) · estado `en_bodega` · página pública transportista `/transporte/:token` · pestaña Pagos Courier · QR codes en remito · LPN+ubicación en panel · bloqueo si no pagado · **ISS-174 (v1.14.0)**: cotización/generación por API de courier (Edge Function `courier-api`, adapters Andreani/Correo/OCA, cotizar en POS+Envíos, generar+etiqueta+tracking) — adapters pendientes de validar con cuentas B2B | ✅ |
| [[wiki/features/notificaciones]] | Tabla real, campana, email, diferencia apertura caja — v1.5.0 | ✅ |
| [[wiki/features/suscripciones-planes]] | Planes Free/Básico/Pro/Enterprise, trial, Mercado Pago | ✅ |
| [[wiki/features/escaneo-barcode]] | BarcodeDetector + ZBar WASM + ZXing (DataMatrix) + Claude Haiku (scan-product) + scan-ticket IA · **ISS-127 (v1.11.5): códigos compuestos GS1 completo — perfiles + lib gs1.ts + generación bwip-js (GS1-128/DataMatrix) + lectura en ingreso/POS/recepciones/rebaje + modo directo + etiquetas masivas** | ✅ |
| [[wiki/features/multi-sucursal]] | Selector, roles, stock · SucursalesPage consolidada v1.8.38 (todos los campos en un modal) · backfill 114–117 · filtros estrictos · cajas por sucursal · **aislamiento por sucursal** (triple blindaje cliente + RLS-por-sucursal pendiente) v1.11.2-dev | ✅ |
| [[wiki/features/alertas]] | Stock bajo, LPNs vencidos, reservas viejas, sin categoría, deuda · filtro por sucursal | ✅ |
| [[wiki/features/recursos]] | Patrimonio del negocio, tab Ubicaciones, recursos recurrentes, integración gastos · ISS-111/112/114 fixes · **v1.8.45**: capitalización (`capitaliza_recurso`) + card "Mantenimiento acumulado" + chips Mantto/Cap en cada card | ✅ |
| [[wiki/features/reportes-metricas]] | Dashboard 9 áreas, SQL Runner, aging individual · fix categoria FK (KPIs en 0) · filtro sucursal inclusivo + banner · nueva nav (area+sub-tabs) · **Trazabilidad-extendida (mig 155): /historial como hub de recall grado WMS — consolida por transacción + trazá unidad por LPN/serie + export completo** | ✅ |
| [[wiki/features/grupos-variantes]] | Grupos de variantes (talle, color, etc.) · ProductoGrupoModal · vista agrupada en ProductosPage · migration 120 | ✅ |
| [[wiki/features/configuracion]] | ConfigPage v2 — 11 tabs temáticas · Mi negocio solo nivel tenant (v1.8.38, campos por sucursal movidos a SucursalesPage) · métodos de pago, comisión, descuento máx, caja, cliente POS | ✅ |

---

## Architecture

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/architecture/frontend-stack]] | React 18, Vite, TypeScript, Tailwind, Zustand, React Query | ✅ |
| [[wiki/architecture/backend-supabase]] | PostgreSQL, Auth, RLS, Storage, Edge Functions, proyectos | ✅ |
| [[wiki/architecture/multi-tenant-rls]] | Modelo multi-tenant, RLS, roles, onboarding | ✅ |
| [[wiki/architecture/estado-global]] | authStore Zustand, usePlanLimits, useSucursalFilter, hooks | ✅ |
| [[wiki/architecture/edge-functions]] | 27+ funciones Deno · scan-ticket (v1.8.38) · lista y propósito de cada una | ✅ |
| [[wiki/architecture/pwa-config]] | Service Worker, manifest, WASM, SPA routing Vercel | ✅ |
| [[wiki/architecture/escalabilidad]] | Costos infra, capacidad escala, cola jobs, Sentry, cloud vs DC | ✅ |

---

## Database

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/database/schema-overview]] | Tablas principales, relaciones, convenciones | ✅ |
| [[wiki/database/migraciones]] | 001–161 en PROD (159 presupuestos · 160 reservas · 161 precio USD) · descripción completa | ✅ |
| [[wiki/database/rls-policies]] | Patrón subquery, funciones helper, Storage, Edge Functions | ✅ |
| [[wiki/database/triggers]] | Stock, numeración, integraciones, nómina, stock mínimo | ✅ |

---

## Integrations

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/integrations/mercado-pago]] | Suscripciones, preapproval, webhooks, IPN, QR pagos | ✅ |
| [[wiki/integrations/mercado-libre]] | OAuth, mapeo productos, webhooks órdenes, sync stock | ✅ |
| [[wiki/integrations/tienda-nube]] | OAuth, mapeo, webhooks, sync worker, BATCH_SIZE 200 | ✅ |
| [[wiki/features/facturacion-afip]] | ← Ver features/facturacion-afip (cubre integración AFIP) | ✅ |
| [[wiki/features/envios]] | ← WhatsApp documentado en features/envios | ✅ |
| [[wiki/integrations/resend-email]] | send-email EF, tipos, FROM, monitoring diario | ✅ |
| [[wiki/integrations/roadmap-apis]] | MODO integración completa (modo-crear-pago + modo-webhook DEV+PROD, v1.8.35), TiendaNube, MercadoLibre | ✅ |

---

## Business

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/business/modelo-negocio]] | Segmento, propuesta de valor, canales | ✅ |
| [[wiki/business/planes-pricing]] | Planes Free/Básico/Pro/Enterprise, features, precios | ✅ |
| [[wiki/business/roadmap]] | Historial v0.26–v1.4.0, backlog, pendientes | ✅ |
| [[wiki/business/mercado-objetivo]] | SMB/Mid-market LatAm, segmentos, posicionamiento competitivo | ✅ |

---

## Development

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/development/workflow-git]] | Ramas main/dev, PRs, releases, checklist pre-deploy | ✅ |
| [[wiki/development/convenciones-codigo]] | Naming, imports, patterns, reglas agente LLM | ✅ |
| [[wiki/development/deploy]] | Vercel + Supabase, dominios, env vars, comandos | ✅ |
| [[wiki/development/testing]] | **412 unit tests** Vitest + Playwright E2E todos los roles · pipeline QA con agentes · `tests/specs/` | ✅ |
| [[wiki/development/agentes-claude-code]] | 9 subagentes de proyecto (.claude/agents/): relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper | ✅ |
| [[wiki/development/supabase-dev-vs-prod]] | DEV vs PROD, flujo migraciones, EF deploy, pg_cron | ✅ |
| [[wiki/development/reglas-negocio]] | Reglas relevadas con GO: caja, ventas, inventario, clientes, **gastos** (Fases 1-5 completas, v1.8.42→v1.9.0) + UAT | ✅ |
| [[wiki/development/cierre-contable]] | **HITO v1.9.0** — cierre contable mensual transversal (gastos+ventas+caja+OC) + notas de corrección + triggers de bloqueo + RPCs cerrar/reabrir | ✅ |

---

## Manuales de uso (por tipo de negocio)

Documentos HTML paso a paso por vertical. Actualizar cuando haya nuevas features relevantes. Abrir en navegador → Ctrl+P → Guardar como PDF.

| Archivo | Negocio | Contenido destacado |
|---------|---------|-------------------|
| [[wiki/manuales/manual-hogar-genesis360]] | 🏠 Familia García — hogar | Despensa, gastos fijos, lista del súper como OC, vencimientos, dashboard financiero |
| [[wiki/manuales/manual-ferreteria-genesis360]] | 🔩 Ferretería Don Beto | SKUs complejos, venta por metro/kg, series en herramientas, CC a constructoras, multi-sucursal |
| [[wiki/manuales/manual-tienda-ropa-genesis360]] | 👗 Tienda Camila — moda + e-comm | Variantes talle × color, sync MeLi + TiendaNube, multichannel POS, envíos, devoluciones |

---

## Support

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/support/supabase-db-rescue]] | Diagnóstico, rescate y mantenimiento de la DB Supabase (pool saturado, conexiones colgadas, restart) | ✅ |

---

## Sources (en `sources/raw/`)

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `arquitectura_escalabilidad.md` | MD | Análisis infra, costos, escala, Sentry, cloud vs DC |
| `reglas_negocio.md` | MD | Reglas relevadas con GO: caja, ventas, inventario, clientes |
| `relevamiento_ventas_respuestas.md` | MD | Respuestas relevamiento Ventas A-K (COMPLETO) — origen del backlog Ventas |
| `relevamiento_clientes_respuestas.md` | MD | Respuestas relevamiento Clientes A-H (COMPLETO 2026-06-01) — plan por fases CL1-CL6, GO pidió implementar todo |
| `uat.md` | MD | Casos UAT con precondiciones, pasos y resultados esperados |
| `genesis360_overview.html` | HTML | Overview visual del proyecto (no procesado) |
| `soporte_tiendanube.html` | HTML | Guía de soporte para conectar TiendaNube |
| `soporte_inventario.html` | HTML | Guía de soporte para módulo inventario |
| `soporte_ventas_caja.html` | HTML | Guía de soporte para ventas y caja |
| `soporte_usuarios_roles.html` | HTML | Guía de soporte para usuarios y roles |

---

*Última actualización: 2026-06-06 — 54 páginas + 3 manuales + relevamientos · DEV: migrations 001-**186** + 086b · PROD: 001-**186** + 086b · **v1.35.0 PROD** ✅ (**Compras CO5** — pago: modo de pago por proveedor (`proveedores.modo_pago`+`anticipo_pct`) → OC propone anticipo (`paga_con_anticipo`/`anticipo_pct` snapshot) + plan de pagos opcional (`pago_schedule JSONB`) + comprobante de transferencia (reusa `comprobante_url`); lib `comprasPago.ts` +16 tests → suite 428, mig 186). · **v1.34.0 PROD** ✅ (**Compras CO3+CO4**: CO3 costos — alerta de cambio de costo al recibir, costos accesorios, alta de producto en recepción (mig 184); CO4 devolución a proveedor — entidad + crédito CC/efectivo/reposición + rebaja stock FIFO (mig 185). Libs `comprasCostos.ts`+`devolucionProveedor.ts`, suite 412. Pendiente Compras: CO5-CO8). v1.32.0 (**Compras CO1+CO2**: CO1 gobierno de OC — creación rol/umbral, aprobación, numeración por sucursal, permisos de pago (mig 182); CO2 recepción robusta — estado de OC por acumulado de recepciones [fix B5], over/under-receipt, motivo de faltante, remito adjunto (mig 183). Libs `comprasPermisos.ts`+`recepcionLogic.ts`, +27 tests → suite 393). v1.30.1 (ISS-151: excluir 'Incobrable' del Dashboard). v1.30.0 (**Conteos 2.0 CERRADO 100%**: cierre F2b-ref escaneo fuera-de-alcance + F3b snapshot costo y doble conteo formal con clave maestra + A2 wall-to-wall bloquea sucursal (toggle default OFF, `useConteoBloqueante`), mig 181). v1.29.0 (**Conteos 2.0 F1-F4**: F2b scan-to-count + F4 clase ABC auto Pareto/cíclico sugerido/reportes exactitud-valorización/trazabilidad, `conteoAbc.ts` +16 tests → suite 362, mig 180). v1.27.0 (Conteos F3: gate vía tab Autorizaciones (`ajuste_conteo`, umbral u/%/$) + reconciliación por delta + doble conteo, `conteoAjuste.ts`, mig 179). v1.26.0 (Conteos F2a modos+a ciegas+unidad+secuencia, mig 178). v1.25.0 (Conteos F1 scope, mig 177). v1.24.0 (Clientes C6+D4). v1.25.0 (Conteos F1 scope Marca/Categoría/Wall-to-wall, mig 177). v1.24.0 (Clientes C6+D4). v1.23.2 (QA tests, suite 330, `cajaArqueo.ts`). v1.23.1 (QA CC → `ccLogic.ts` · 9 subagentes). **Módulo Clientes COMPLETO CL1–CL6** (v1.19.0-v1.23.0) (Relevamiento Ventas VF5: edición post-venta + NC interna, sin migración — **Relevamiento Ventas A-K COMPLETO**). VF4 v1.16.0 (reportes/alertas), VF1-VF3 v1.15.0 (POS/canales/auditoría). v1.14.x: ISS-174 envíos por API de courier + hotfix onboarding. · **Relevamiento Clientes A-H COMPLETO** (2026-06-01) → plan por fases CL1-CL6 (v1.18.0→v1.23.0) en `relevamiento_clientes_respuestas.md`. **CL1 (mig 171) + CL2 (mig 172) deployados en PROD** (v1.19.0, PR #140). Próximo: CL3.*
