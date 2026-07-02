---
title: Genesis360 — Overview
category: overview
tags: [saas, wms, inventario, argentina, overview, hub]
sources: [CLAUDE.md, project_pendientes.md]
updated: 2026-07-01
---

# Genesis360 — Overview

> **Punto de entrada del wiki.** Qué es Genesis360 y el mapa de módulos con enlaces al detalle.
> Las cifras que cambian seguido (versión, migraciones, Edge Functions, tests, estado DEV/PROD)
> **no viven acá** para no duplicarse: están en `sources/raw/project_pendientes.md` y [[roadmap]].

**Genesis360** es un SaaS **integral** de gestión para comercios físicos de Argentina (retail, ferreterías, almacenes, tiendas de ropa, distribuidoras). Tagline: *"El inventario inteligente para tu negocio"*. La propuesta central no es solo mostrar datos, sino **recomendar acciones**.

Combina **POS · Inventario/WMS · Facturación AFIP · Caja/Bóveda · Compras · Envíos · Clientes/CC · RRHH · Analítica** en una sola app, **multi-tenant** y **multi-sucursal**, con dos modos de operación (Básico / Avanzado — ver [[modo-basico-avanzado]]).

---

## Documentos hermanos (cada uno con su rol — no duplicar)

| Documento | Rol | Para quién |
|-----------|-----|-----------|
| **Este archivo** (`genesis360-overview.md`) | Hub / índice del wiki con enlaces | Equipo / IA navegando el wiki |
| [[app-reference]] (`app-reference.md`) | Referencia técnica **ruta-por-ruta** (cada `/ruta`, flujos, WMS, seguridad) | IA / equipo (contexto técnico) |
| `sources/raw/genesis360_overview.html` | **Documento de producto** presentable / imprimible | Externos (pitch, clientes) |
| `sources/raw/project_pendientes.md` + [[roadmap]] | **Estado, versión y pendientes** (fuente única de cifras volátiles) | Equipo |
| [[planes-pricing]] / [[suscripciones-planes]] | Planes, precios y límites | Negocio / producto |

---

## Mapa de módulos (en producción)

| Módulo | Página del wiki | Descripción |
|--------|-----------------|-------------|
| **Inventario / WMS** | [[inventario-stock]] · [[wms]] | LPNs, ubicaciones, lotes, series, FIFO/FEFO, KITs, conteos, autorizaciones |
| **Productos / Variantes** | [[productos]] · [[grupos-variantes]] | SKUs, variantes (talla/color), estructura, escaneo ([[escaneo-barcode]]) |
| **Ventas / POS** | [[ventas-pos]] | Estados, seña/reserva, combos, split de pago, saldo a favor, CC |
| **Facturación AFIP** | [[facturacion-afip]] | A/B/C, NC/ND, CAE, QR RG 4291, Ley 27.743 (vía AfipSDK) |
| **Devoluciones** | [[devoluciones]] | Total/parcial, reingreso de stock, Nota de Crédito, reintegro |
| **Caja / Bóveda** | [[caja]] | Multi-caja, arqueos, ticket de cierre, Caja Fuerte/capital, traspasos |
| **Gastos** | [[gastos]] | Categorías, proveedores, IVA crédito, egreso automático a caja |
| **Compras (OC + Recepciones)** | *(ver [[app-reference]] §3.10–3.11)* | Órdenes de compra, recepciones, pagos a proveedores |
| **Clientes / Proveedores** | [[clientes-proveedores]] | CRM, cuenta corriente, domicilios, saldo a favor, portal por token |
| **Envíos** | [[envios]] | Reparto propio, tarifas, POD, hoja de ruta y portal del transportista |
| **RRHH** | [[rrhh]] | Empleados, fichado QR, vacaciones, asistencia, nómina contable |
| **Alertas / Notificaciones** | [[alertas]] · [[notificaciones]] | Stock, vencimientos, deuda, diferencia de caja, cumpleaños |
| **Dashboard / Reportes** | [[reportes-metricas]] | 5 sub-pestañas por área, KPIs, rentabilidad, recomendaciones, exports |
| **Multi-sucursal** | [[multi-sucursal]] | Aislamiento por sucursal server-side (RLS en 23 tablas) |
| **Recursos / Biblioteca** | [[recursos]] | Activos del negocio y material de referencia |
| **Marketplace** | [[marketplace]] | API pública por tenant, sync (activación manual) |
| **Suscripciones** | [[suscripciones-planes]] | Free / Básico / Pro / Enterprise + add-ons |
| **Config / Onboarding** | [[configuracion]] · [[autenticacion-onboarding]] | Datos del negocio y fiscales, usuarios/roles, modo de operación |

---

## Arquitectura (resumen — detalle en las páginas de architecture)

- **Frontend:** React 18 + Vite + TypeScript + Tailwind (PWA). Estado: Zustand + React Query. → [[frontend-stack]]
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage). Deploy: Vercel. → [[backend-supabase]] · [[edge-functions]]
- **Multi-tenant:** aislamiento por `tenant_id` con RLS en toda la data. → [[multi-tenant-rls]]
- **Integraciones:** Mercado Pago, AfipSDK, Resend, Cloudflare Email Routing, Claude (Anthropic), Google Maps.

---

## Links relacionados

- [[frontend-stack]] · [[backend-supabase]] · [[edge-functions]] · [[multi-tenant-rls]] · [[estado-global]] · [[pwa-config]] · [[escalabilidad]]
- [[modelo-negocio]] · [[mercado-objetivo]] · [[planes-pricing]] · [[roadmap]]
- [[app-reference]] — referencia técnica completa ruta-por-ruta
