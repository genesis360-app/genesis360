---
name: Genesis360 - contexto del proyecto
description: Stack, arquitectura, módulos y estado actual del producto Genesis360 (ex-Stokio)
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
**Producto:** Genesis360 — WMS SaaS multi-tenant argentino (en producción)
**Nombre anterior:** Stokio — rebrand completado en v0.45.0. No usar "Stokio" en código ni docs.

**Stack:** React + Vite + TypeScript + Supabase (auth + DB + storage) + Tailwind CSS + TanStack Query + React Router + Lucide icons + react-hot-toast

**Repo:** https://github.com/genesis360-app/genesis360 — rama principal: `main` (público)
**Dominio:** https://genesis360.pro (Porkbun → Vercel)
**Supabase PROD:** `jjffnbrdjchquexdfgwq` · **DEV:** `gcmhzdedrkmmzfzfveig`

**Versión actual:** v0.75.0 en DEV · v0.74.2 en PROD (migrations 047+048 pendientes en PROD)
**Tests:** 154/154 (Vitest unit) + Playwright E2E (CAJERO/SUPERVISOR/RRHH roles + 12 spec files)

**Módulos actuales:**
- Inventario (productos, ubicaciones, estados, grupos, aging profiles)
- Movimientos (ingreso, rebaje, ajuste) + importación Excel + ingreso/rebaje masivo multi-SKU
- Estructura de producto (WMS Fase 1): `producto_estructuras` niveles unidad/caja/pallet
- WMS Fase 2: dimensiones físicas en `ubicaciones` (tipo, alto/ancho/largo/peso/pallets)
- KITs/Kitting (WMS Fase 2.5): `kit_recetas` + `kitting_log` + armado/desarmado + clonar
- Ventas — carrito, reserva, despacho, historial, ticket, LPN multi-fuente en carrito
- Devoluciones (migration 030): botón Devolver, lógica stock, NC automática, egreso caja
- Caja — sesiones, movimientos, seña en caja, traspasos entre cajas, multi-usuario, polling 10s
- Métodos de pago configurables (migration 045) — CRUD en ConfigPage + MixCajaChart colores DB
- IVA por producto (migration 042): alicuota 0/10.5/21/27% · desglose en checkout
- Alertas (stock mínimo, sin categoría, reservas viejas, deuda clientes)
- Dashboard: KPIs + Design System (FilterBar, KPICard, InsightCard, gráficos La Balanza + Mix)
- Métricas (ganancia neta, ranking, margen objetivo, inventario por ubicación)
- Reportes (Excel/PDF, breakdown por método de pago)
- Gastos (egreso auto en caja para efectivo, egreso_informativo para otros medios; IVA deducible + comprobantes adjuntos storage bucket `comprobantes-gastos` + gastos fijos recurrentes — migration 048)
- Clientes (historial, stats, importación masiva CSV/Excel con DNI)
- RRHH completo — Phases 1–5 en PROD: empleados, nómina, vacaciones, asistencia, documentos, capacitaciones, supervisor self-service, feriados AR
- Roles: OWNER, SUPERVISOR, CAJERO, RRHH, ADMIN, CONTADOR, DEPOSITO + roles custom
- Mi Cuenta (/mi-cuenta): avatar, plan, contraseña, salir/eliminar tenant
- Multi-sucursal (migration 025) — SucursalesPage + SucursalSelector en header
- Suscripción/plan (MP preapproval) + add-ons movimientos + matriz features por plan
- Marketplace (EF pública + webhook)
- Biblioteca de Archivos (migration 042) + Certificados AFIP (migration 043)
- Design System Sprint 1–4: tokens (`bg-surface`, `text-primary`, `text-muted`, etc.)

**E2E usuarios de prueba (DEV):** OWNER `e2e@genesis360.test` · CAJERO `cajero1@local.com` · RRHH `rrhh1@local.com` · SUPERVISOR `supervisor@test.com` — todos contraseña `123`

**Patrones clave:**
- Multi-tenant: siempre filtrar por `tenant_id`
- Stock: `inventario_lineas.cantidad - cantidad_reservada` = disponible; series en `inventario_series`
- Medios de pago: JSON `[{tipo, monto}]` en `ventas.medio_pago`; efectivo → caja real; otros → ingreso_informativo
- Cotización USD: hook global `useCotizacion` (sidebar, no campo local)
- Rutas producto: `/productos/nuevo`, `/productos/:id/editar` · Inventario: `/inventario`

**Seguridad:**
- `.env.local` NO está en git (`.gitignore` completo desde v0.44.1)
- Todas las API keys rotadas en 2026-03: MP, Resend, Supabase AT, GitHub Token
- GH_TOKEN en Windows Credential Manager — nunca en `.env.local`
- Repo público → no commitear secrets nunca

**Why:** App productiva con clientes reales; priorizar no romper funcionalidad existente.
**How to apply:** Siempre verificar rutas en App.tsx antes de navigate(). Siempre chequear schema antes de agregar columnas. Nunca usar "Stokio" en código nuevo.
