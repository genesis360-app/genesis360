---
title: Genesis360 — Overview
category: overview
tags: [saas, wms, inventario, argentina, overview]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# Genesis360 — Overview

**Genesis360** es un SaaS de gestión de inventario (WMS) para pequeños comercios físicos de Argentina. Tagline: *"El cerebro del negocio físico"*. La propuesta central no es solo mostrar datos, sino **recomendar acciones**.

**Versión actual:** v1.6.0 en PROD ✅ (al 2026-05-05)

---

## Qué es

Sistema de gestión todo-en-uno diseñado para:
- Almacenes / despensas / ferreterías
- Kioscos y minimercados
- Cualquier negocio físico con stock, caja y empleados

Combina: POS · Inventario WMS · RRHH · Métricas · Facturación AFIP · Marketplace · Envíos en una sola app.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| State | Zustand (`authStore`) + TanStack React Query v5 |
| Backend | Supabase (PostgreSQL + Auth + RLS + Storage) |
| Serverless | 26 Edge Functions (Deno) |
| Pagos plataforma | Mercado Pago (preapproval mensual) |
| Pagos ventas | Mercado Pago QR / Link de pago |
| Deploy | Vercel (frontend) + Supabase (backend) |
| PWA | vite-plugin-pwa |
| Testing | Vitest (154+ unit tests) + Playwright (E2E todos los roles) |

---

## Dominios de producción

- `www.genesis360.pro` → Landing page (marketing)
- `app.genesis360.pro` → Aplicación autenticada

---

## Módulos completos en producción

| Módulo | Página | Descripción |
|--------|--------|-------------|
| **Inventario** | [[wiki/features/inventario-stock]] | LPNs, WMS, KITs, conteos, autorizaciones |
| **Ventas / POS** | [[wiki/features/ventas-pos]] | 3 modos, pago parcial, combos, CC |
| **Caja** | [[wiki/features/caja]] | Multi-caja, traspasos, arqueos |
| **Gastos** | [[wiki/features/gastos]] | Variables, fijos, IVA, comprobantes |
| **Devoluciones** | [[wiki/features/devoluciones]] | Serializado/no-serializado, NC |
| **Clientes** | [[wiki/features/clientes-proveedores]] | CRM, CC, domicilios, notas |
| **Proveedores** | [[wiki/features/clientes-proveedores]] | OC, servicios, presupuestos |
| **Facturación AFIP** | [[wiki/features/facturacion-afip]] | A/B/C, AfipSDK, CAE, PDF con QR AFIP |
| **Notificaciones** | [[wiki/features/notificaciones]] | Campana real, emails, diferencia caja |
| **Envíos** | [[wiki/features/envios]] | Estados, remito PDF, WA Click-to-Chat |
| **RRHH** | [[wiki/features/rrhh]] | 5 fases: nómina, vacaciones, asistencia |
| **Alertas** | [[wiki/features/alertas]] | Stock, vencidos, deuda, sin categoría |
| **Reportes** | [[wiki/features/reportes-metricas]] | Dashboard 5 tabs, KPIs, exportación |
| **WMS** | [[wiki/features/wms]] | Estructuras, ubicaciones, KITs, ASN |
| **Marketplace** | [[wiki/features/marketplace]] | API pública, sync MeLi/TN |
| **Suscripciones** | [[wiki/features/suscripciones-planes]] | Free/Básico/Pro/Enterprise |

---

## Arquitectura de alto nivel

```
Usuario
  ↓
Vercel (React SPA + PWA)
  ↓
Supabase
  ├── PostgreSQL (83 migraciones, multi-tenant RLS)
  ├── Auth (Google OAuth + Email/Password)
  ├── Storage (productos, avatares, empleados, certificados AFIP, etc.)
  └── 26 Edge Functions (Deno)
        ├── Mercado Pago (suscripciones + pagos ventas + add-ons)
        ├── AFIP (emitir-factura via AfipSDK)
        ├── Mercado Libre (oauth, webhook, stock-worker)
        ├── TiendaNube (oauth, webhook, stock-worker)
        ├── Email (Resend — send-email + monitoring-check)
        ├── IA (scan-product → Claude Haiku)
        └── Monitoring (monitoring-check diario 9 AM AR)
```

---

## Estado del proyecto al 2026-04-30

| Métrica | Valor |
|---------|-------|
| Versión PROD | v1.6.0 |
| Migraciones DB | 85 |
| Edge Functions | 26 |
| Unit tests | 154+ (Vitest) |
| Archivos TS/TSX | ~80 |
| Supabase PROD | `jjffnbrdjchquexdfgwq` |
| Supabase DEV | `gcmhzdedrkmmzfzfveig` |

---

## Planes

| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| Free | 1 | 50 | $0 |
| Básico | 2 | 500 | $4.900 ARS/mes |
| Pro | 10 | 5.000 | $9.900 ARS/mes |
| Enterprise | ∞ | ∞ | A consultar |

Trial: 14 días acceso Pro sin tarjeta.

---

## Links relacionados

- [[wiki/architecture/frontend-stack]]
- [[wiki/architecture/backend-supabase]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/architecture/estado-global]]
- [[wiki/business/modelo-negocio]]
- [[wiki/business/roadmap]]
- [[wiki/development/deploy]]
