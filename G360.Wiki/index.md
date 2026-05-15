# Índice del Wiki — Genesis360

Catálogo completo de páginas. Actualizar en cada ingest, query guardado, o modificación.

---

## Overview

| Página                                | Descripción                                          | Estado |
| ------------------------------------- | ---------------------------------------------------- | ------ |
| [[wiki/overview/genesis360-overview]] | Visión general v1.4.0, stack, módulos, estado actual | ✅      |

---

## Features

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/features/autenticacion-onboarding]] | Google OAuth, roles, trial, session timeout | ✅ |
| [[wiki/features/inventario-stock]] | LPNs, movimientos, FIFO/FEFO, stock por sucursal, bulk edit atributos | ✅ |
| [[wiki/features/ventas-pos]] | Carrito, checkout, métodos de pago, reservas, combos | ✅ |
| [[wiki/features/caja]] | Sesiones, traspasos, arqueos, multi-caja, roles | ✅ |
| [[wiki/features/gastos]] | Variables, fijos, IVA deducible, comprobantes, múltiples medios | ✅ |
| [[wiki/features/devoluciones]] | Stock serializado/no-serializado, NC, caja | ✅ |
| [[wiki/features/clientes-proveedores]] | CRM, cuenta corriente, OC, domicilios, servicios | ✅ |
| [[wiki/features/facturacion-afip]] | AFIP WSFE, tipos A/B/C, AfipSDK, FacturacionPage 4 tabs | ✅ DEV |
| [[wiki/features/rrhh]] | 5 fases: empleados, nómina, vacaciones, asistencia, supervisor | ✅ |
| [[wiki/features/wms]] | Estructuras, ubicaciones, KITs, kitting, conteos, recepciones | ✅ |
| [[wiki/features/marketplace]] | API pública, webhook saliente, publicación por producto | ✅ |
| [[wiki/features/envios]] | Propio (Google Maps + KM auto) · Courier (tarifas config) · canal auto · sin cotizador | ✅ DEV |
| [[wiki/features/notificaciones]] | Tabla real, campana, email, diferencia apertura caja — v1.5.0 | ✅ |
| [[wiki/features/suscripciones-planes]] | Planes Free/Básico/Pro/Enterprise, trial, Mercado Pago | ✅ |
| [[wiki/features/escaneo-barcode]] | BarcodeDetector + ZBar WASM + Claude Haiku fallback | ✅ |
| [[wiki/features/multi-sucursal]] | Selector por módulo, roles puedeVerTodas, stock por sucursal, bulk edit LPNs | ✅ |
| [[wiki/features/alertas]] | Stock bajo, LPNs vencidos, reservas viejas, sin categoría, deuda · filtro por sucursal | ✅ |
| [[wiki/features/recursos]] | Patrimonio del negocio, tab Ubicaciones, recursos recurrentes, integración gastos | ✅ |
| [[wiki/features/reportes-metricas]] | KPIs, dashboard 5 tabs, FilterBar, Recharts, exportación | ✅ |

---

## Architecture

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/architecture/frontend-stack]] | React 18, Vite, TypeScript, Tailwind, Zustand, React Query | ✅ |
| [[wiki/architecture/backend-supabase]] | PostgreSQL, Auth, RLS, Storage, Edge Functions, proyectos | ✅ |
| [[wiki/architecture/multi-tenant-rls]] | Modelo multi-tenant, RLS, roles, onboarding | ✅ |
| [[wiki/architecture/estado-global]] | authStore Zustand, usePlanLimits, useSucursalFilter, hooks | ✅ |
| [[wiki/architecture/edge-functions]] | 26 funciones Deno, lista y propósito de cada una | ✅ |
| [[wiki/architecture/pwa-config]] | Service Worker, manifest, WASM, SPA routing Vercel | ✅ |
| [[wiki/architecture/escalabilidad]] | Costos infra, capacidad escala, cola jobs, Sentry, cloud vs DC | ✅ |

---

## Database

| Página | Descripción | Estado |
|--------|-------------|--------|
| [[wiki/database/schema-overview]] | Tablas principales, relaciones, convenciones | ✅ |
| [[wiki/database/migraciones]] | Las 83 migraciones con descripción completa (001-083) | ✅ |
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
| [[wiki/development/testing]] | 154+ unit tests Vitest + Playwright E2E todos los roles | ✅ |
| [[wiki/development/supabase-dev-vs-prod]] | DEV vs PROD, flujo migraciones, EF deploy, pg_cron | ✅ |
| [[wiki/development/reglas-negocio]] | Reglas relevadas con GO: caja, ventas, inventario + UAT | ✅ |

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
| `uat.md` | MD | Casos UAT con precondiciones, pasos y resultados esperados |
| `genesis360_overview.html` | HTML | Overview visual del proyecto (no procesado) |
| `soporte_tiendanube.html` | HTML | Guía de soporte para conectar TiendaNube |
| `soporte_inventario.html` | HTML | Guía de soporte para módulo inventario |
| `soporte_ventas_caja.html` | HTML | Guía de soporte para ventas y caja |
| `soporte_usuarios_roles.html` | HTML | Guía de soporte para usuarios y roles |

---

*Última actualización: 2026-05-14 — 48 páginas · 8 fuentes en raw/ · 107 migraciones · v1.8.20-dev / v1.8.19-prod*
