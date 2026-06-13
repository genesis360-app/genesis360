---
title: Modo de operación — Básico vs Avanzado (WMS)
category: features
tags: [modo-operacion, basico, avanzado, wms, planes, pro, gating, tenants]
sources: [project_pendientes.md]
updated: 2026-06-12
---

# Modo de operación — Básico vs Avanzado (WMS)

Dos experiencias en un solo SaaS (v1.55.0, mig 207):

- **Básico** (default para tenants NUEVOS, disponible en todos los planes): experiencia de mostrador para kioscos, almacenes y pymes chicas. POS, caja, productos simples, stock simple, clientes con CC, gastos. Sin LPN, lotes, series, vencimientos, ubicaciones, OC ni envíos.
- **Avanzado (WMS)**: el sistema completo (trazabilidad estilo Manhattan/Blue Yonder). Toggle del DUEÑO en **Configuración → Negocio → Modo de operación**, gateado a plan **Pro+** (feature `wms`; el trial lo prueba automáticamente porque `usePlanLimits` da features de Pro durante trial activo).

## Principio de diseño (invariante)

**El modo gatea UI, nunca datos.** Los flujos de datos se gatean por producto (`tiene_series/tiene_lote/tiene_vencimiento`), como siempre. El backend no cambia: LPN auto-generado, `venta_item_despachos`, triggers de `stock_actual` y FIFO corren igual en ambos modos. Por eso:

- Un negocio básico que crece activa el avanzado y **todo su historial ya es trazable** (sin migración de datos).
- **Regla de integridad**: un producto heredado con tracking sigue pidiendo serie/lote/vencimiento al mover stock aun en básico (nunca se mueve stock trackeado "a ciegas"). En el form de producto esos campos se muestran solo-lectura con nota.
- Bajar a básico **no borra nada**: los datos WMS solo dejan de mostrarse.

## Resolución del modo

`avanzado efectivo = tenants.modo_operacion === 'avanzado' && limits.puede_wms` — lib pura [`src/lib/modoOperacion.ts`](../../../src/lib/modoOperacion.ts) (`esModoAvanzado`, `motivoBasico`, `productoRequiereTracking`, `sugiereModoAvanzado`; 14 tests) + hook `useModoOperacion()` (único punto de consulta de la UI). Si el tenant baja de plan o vence el trial con el toggle activo → cae a básico automáticamente, con aviso en Config (`motivo='plan_insuficiente'`) y CTA a `/suscripcion`.

## Matriz de módulos

**Nav básico "Mínimo mostrador" (v1.57.0):** un DUEÑO con 1 sucursal y sin facturación ve **12 módulos usables** — Dashboard, Ventas, Caja, Productos, Inventario, Clientes, Gastos, Proveedores, Alertas, Reportes, Usuarios, Configuración (+ RRHH/Reportes en gris como upsell de plan).

| Módulo | Básico | Avanzado |
|---|---|---|
| Dashboard, Ventas (POS), Caja, Clientes, Gastos, Reportes/Alertas, Usuarios, Config | ✅ | ✅ |
| **Facturación** | solo si `facturacion_habilitada` | ✅ |
| **Sucursales** | solo si >1 sucursal | ✅ |
| Productos | Form simple (sin tracking/regla/aging/peso-dim/ubicación-estado default; **sin "Es un KIT" ni precios mayoristas** — v1.58.0). Quedan: variantes talle/color, precio USD | Completo |
| Inventario | Stock + agregar/quitar simplificados + conteo rápido + Traslados (solo si >1 sucursal); **sin pestaña Kits** (v1.58.0) | Completo (LPN, ubicaciones, estados, vista por ubicación, conteos guiado/ciego/ABC/cíclico, acciones LPN, Kits) |
| Gastos | Variables/fijos/historial + cheques/cierres/autorizaciones; **sin OC, Reportes-compras ni Recursos** (v1.58.0) | Completo |
| Proveedores | Ficha + CC + pagos (sin OC/presupuestos/calificación) | Completo |
| **Recursos** (activos fijos) | ❌ | ✅ |
| **Biblioteca** (documentos) | ❌ | ✅ |
| **Recepciones + OC** | ❌ (stock entra por Inventario → Agregar) | ✅ |
| **Envíos** | ❌ (costo de envío manual en el POS) | ✅ |
| **Historial/Trazabilidad** | ❌ (movimientos en el tab Historial de Inventario) | ✅ |
| RRHH | Gate de plan existente (`puede_rrhh`), sin cambios | ídem |

## Visibilidad de nav y auditoría de roles (v1.57.0)

La decisión de qué módulos ve cada usuario vive en la función pura [`src/lib/navVisibility.ts`](../../../src/lib/navVisibility.ts) (`navItemVisible` + `navItemLocked`), consumida por `AppLayout`. Está cubierta por una **matriz rol × modo** en `tests/unit/navVisibility.test.ts` (cada rol conserva su trabajo core en básico y avanzado). **Regla clave:** el permiso explícito por rol (`depositoVisible`/`contadorVisible`/`cajeroVisible`/`rrhhVisible`) **prevalece sobre `ownerOnly`/`supervisorOnly`** — esto corrigió dos bugs (DEPOSITO no veía Recepciones, CONTADOR no veía Historial).

**Rol custom read-only:** los `permisos_custom[modulo]` ahora se aplican también en las mutaciones, no solo en el nav. Helper [`src/lib/permisosModulo.ts`](../../../src/lib/permisosModulo.ts) (`moduloSoloLectura`/`moduloOculto`/`puedeEditarModulo`): un rol custom marcado `'ver'` no puede crear/editar en Ventas, Caja, Inventario, Productos, Gastos ni Clientes.

**e2e por rol:** además de owner/cajero/supervisor/rrhh existen specs para **DEPOSITO** (17) y **CONTADOR** (18), gated por credenciales `E2E_DEPOSITO_*`/`E2E_CONTADOR_*` (se omiten si faltan).

## Implementación F1 (v1.55.0 — hecho)

- **Mig 207**: `tenants.modo_operacion` (`'basico'`/`'avanzado'`, default `'basico'`) + backfill existentes → `'avanzado'` (cero impacto al deployar).
- **brand.ts**: feature `wms` en `FEATURES_POR_PLAN` pro/enterprise + `PLAN_REQUERIDO.wms='pro'` + copy en `PLANES` + kill-switch `MODO_BASICO_ENABLED`.
- **Nav/rutas** (`AppLayout.tsx`): flag `avanzadoOnly` en Recepciones/Envíos/Historial + guard de rutas (deep-link en básico → toast + redirect a dashboard).
- **Config** (`ConfigPage.tsx` → tab Negocio): card `ModoOperacionSection` — radio Básico/Avanzado, candado + CTA si el plan no alcanza, **advertencia de downgrade** con conteo de productos trackeados, aviso si quedó en básico por plan insuficiente. Persiste con `setTenant(data)` + `logActividad` (entidad `tenant`).
- **Productos** (`ProductoFormPage.tsx`): en básico se ocultan toggles de tracking, regla de inventario, aging/shelf-life, peso/dimensiones, ubicación/estado default; heredados con tracking → solo-lectura.
- **Inventario** (`InventarioPage.tsx`): Traslados solo si >1 sucursal · sin vista por ubicación · ingreso individual/masivo sin LPN/estado/ubicación/estructura (defaults) · rebaje con líneas presentadas como "Ingreso del DD/MM/AAAA" (sin LPN/grupos/búsqueda WMS) · conteo forzado rápido (sin guiado/ciego, sin alcance por ubicación, sin panel ABC/cíclico) · grilla de líneas sin LPN/estado/ubicación/checkboxes masivos/acciones LPN.

## Rollback (4 capas)

1. **Kill-switch global**: `MODO_BASICO_ENABLED=false` en `brand.ts` → todo el SaaS opera en avanzado (UI pre-v1.55) y el toggle desaparece de Config.
2. **Por tenant / global sin deploy**: `UPDATE tenants SET modo_operacion='avanzado'`.
3. **Rollback de release**: mig aditiva → el front anterior funciona con la columna presente.
4. **No-pérdida**: en básico los datos WMS no se degradan; volver a avanzado los muestra intactos.

## Implementación F2+F3 (v1.56.0 — hecho, sin migración)

- **F2 — superficies internas en básico**: POS (`VentasPage.tsx`) sin picker de LPN ni cotización por API de courier (costo de envío manual queda) · Proveedores (`ProveedoresPage.tsx`) sin tab Órdenes de compra ni "Comparar presupuestos" · Config sin tab Envíos, Inventario reducido a Categorías/Motivos/Unidades (Reglas/Ubicaciones/Estados/Códigos GS1 = avanzado), Gastos sin gobierno de OC; deep-links redirigen · Dashboard sin chip de área Envíos.
- **F3 — adquisición**: banner descartable en Dashboard para DUEÑO en básico cuando `sugiereModoAvanzado(tipo_comercio)` (repuestos, construcción, electrónica, farmacia, ferretería, perfumería, veterinaria) con CTA a Configuración (dismiss por tenant en localStorage) · copy de planes en `PLANES` (Pro vende "Modo avanzado (WMS)", hecho en F1).

## Estado

✅ **EN PROD desde v1.57.0 (2026-06-13, PR #189, mig 207).** F1+F2+F3 + auditoría de roles. Al deployar, los tenants existentes quedaron en `avanzado` (cero impacto). Kill-switch `MODO_BASICO_ENABLED` disponible para rollback global.

**Pendiente menor:** crear usuarios de prueba DEPOSITO+CONTADOR en DEV para correr los e2e de esos roles (se omiten sin credenciales).

## Links relacionados

- [[wiki/features/wms]]
- [[wiki/features/inventario-stock]]
- [[wiki/business/planes-pricing]]
- [[wiki/database/migraciones]]
