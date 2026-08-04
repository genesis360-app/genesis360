---
title: Módulo Comercial (Combos, Cupones, Descuentos vigentes)
category: features
tags: [comercial, combos, cupones, descuentos, roles-custom, delegable]
sources: [src/pages/ComercialPage.tsx, src/pages/ConfigPage.tsx, src/App.tsx, src/components/layout/AppLayout.tsx, src/pages/UsuariosPage.tsx, src/lib/cupones.ts]
updated: 2026-08-04
---

# Módulo Comercial

> **🟢 Fase D del backlog de Fede (25/7/2026) — ✅ construida, EN DEV, SIN deploy a PROD.**
> Consolida Combos y Cupones (que vivían en Config → Ventas → Descuentos y combos) en un módulo
> propio, **delegable** a un rol que no sea el DUEÑO — a diferencia de Configuración, que sigue
> siendo exclusiva del dueño por diseño (datos sensibles/reglas estructurales del negocio). Ver
> [[wiki/features/precios-tiers-empaque]] para el resto de la iniciativa (Fases F/A/B/C) y
> [[wiki/features/inventario-stock]] para la Fase B (aprobación de cambio de estado con foto).
> **e2e (2026-08-04):** permisos/delegación cubiertos por specs 124/125/127
> (`tests/specs/uat-modo-basico.md` §49, escenarios 93-99) — scoping por sucursal de combos,
> delegación por rol custom (solo restringe, nunca amplía), acceso directo por URL según rol.

## Por qué un módulo nuevo

Combos, cupones y descuentos por estado son trabajo **operativo** que el dueño necesita poder
delegar a alguien de confianza sin darle acceso a Configuración completa (que sí tiene que quedar
exclusiva del dueño, para evitar fraude interno — ver Regla de Oro #0). Por eso es un módulo propio,
separado de Config y de Ventas.

## Estructura (`src/pages/ComercialPage.tsx`, ruta `/comercial`)

3 tabs, con `PageTabs`:

1. **Combos** — CRUD de combos de productos (%, $ARS, USD), presets 3×2/2×1/2da unidad, vigencia
   por fecha. Movido tal cual desde Config (mismo modelo de datos, misma tabla `combos`/
   `combo_items`) — es relocalización de UI, no rediseño.
2. **Cupones** — descuento fijo en $ sobre el total de la venta. Movido tal cual desde Config (mig
   332). Ver [[wiki/features/precios-tiers-empaque]] → Fase C para el detalle técnico completo
   (tablas, canje en el POS, prorrateo fiscal).
3. **Descuentos vigentes** (nuevo): lista el inventario que HOY está en un estado con
   `descuento_pct` configurado (`estados_inventario`, mig 284) y hasta cuándo — la fecha de
   vencimiento del lote, si tiene una cargada. La **configuración** del % por estado sigue viviendo
   en Config → Inventario → Estados (no se movió); acá solo se **visualiza** el efecto real.

## Acceso y permisos

- **Nav item** (`AppLayout.tsx`): `supervisorOnly: true` → visible por default para
  DUEÑO/SUPERVISOR/SUPER_USUARIO (mismo criterio que Pedidos/Recepciones/Picking).
- **Para delegar a un empleado puntual** sin darle el resto de los módulos de nivel supervisor: el
  dueño le asigna el rol base **SUPERVISOR** y crea un **rol custom "Comercial"** (Usuarios → Roles)
  que oculta (`no_ver`) todo lo demás, dejando visible solo Comercial. Se agregó `'comercial'` a la
  lista `MODULOS` de `UsuariosPage.tsx` para que el toggle exista.
- **Solo-lectura**: un rol custom marcado `'ver'` en `comercial` ve el módulo pero no puede crear/
  editar/eliminar (`moduloSoloLectura(user, 'comercial')`, mismo helper que usa el resto de la app —
  `src/lib/permisosModulo.ts`).
- **🛑 A propósito NO se le dio acceso a `ADMIN`**: en Genesis360 `rol='ADMIN'` es un rol de **STAFF
  interno de la plataforma** (acceso cross-tenant, protegido desde la mig 254 — ver
  `reference_rol_admin_staff_aislamiento` en memoria), no un rol de negocio que un tenant pueda
  asignar a sus propios empleados. El "Admin" que menciona el pedido de Fede ("Dueño, Admin,
  Supervisor y un rol Comercial") se cubre con DUEÑO/SUPERVISOR — darle a `ADMIN` acceso a este
  módulo habría expuesto datos comerciales de CUALQUIER tenant al staff de Genesis360, algo que el
  pedido nunca pidió.

## Lo que se sacó de `ConfigPage.tsx`

Las cards de "Combos de productos" y "Cupones" (con todo su estado/queries/handlers) se borraron de
`ConfigPage.tsx` → Ventas → sub-tab Descuentos. Queda ahí:

- Un link "Combos y Cupones se movieron al módulo Comercial →" apuntando a `/comercial`.
- **"Límites de descuento por rol"** (tope % del SUPERVISOR sobre descuentos manuales) — eso SÍ
  sigue siendo exclusivo del dueño, no se movió.

## 🛑 Bug real encontrado al portar el código

El `addCombo` original mandaba `sucursal_id: sucursalId || null` para que un combo nuevo quedara
scopeado a la sucursal activa del usuario que lo crea. Se perdió en el primer port a
`ComercialPage.tsx` (una omisión, no un cambio intencional) y se corrigió comparando campo por
campo contra el `ConfigPage.tsx` original antes de dar la fase por cerrada — sin ese chequeo, todo
combo nuevo creado desde el módulo Comercial hubiera quedado global (todas las sucursales) en vez
de scopeado, silenciosamente.

## Sin migración

Fase D es 100% frontend: las tres vistas leen tablas que ya existían (`combos`, `cupones`,
`cupones_codigos`, `estados_inventario`, `inventario_lineas`), todas con su RLS de siempre.

## Links relacionados

- [[wiki/features/precios-tiers-empaque]] — el resto de la iniciativa de Fede (Fases F/A/B/C).
- [[wiki/features/inventario-stock]] — Fase B (aprobación de cambio de estado con foto).
- [[wiki/features/configuracion]] — de dónde se movieron Combos/Cupones; "Límites de descuento por
  rol" que se quedó ahí.
- [[wiki/features/ventas-pos]] — dónde se consumen los combos/cupones en el carrito real.
