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

| Módulo | Básico | Avanzado |
|---|---|---|
| Dashboard, Ventas (POS), Caja, Clientes, Gastos, Reportes/Métricas/Alertas, Usuarios, Sucursales, Config, Facturación | ✅ | ✅ |
| Productos | Form simple (sin tracking/regla/aging/peso-dim/ubicación-estado default) | Completo |
| Inventario | Stock + agregar/quitar simplificados + conteo rápido + Traslados (solo si >1 sucursal) | Completo (LPN, ubicaciones, estados, vista por ubicación, conteos guiado/ciego/ABC/cíclico, acciones LPN) |
| Proveedores | Ficha + CC + pagos (F2: ocultar OC/presupuestos/calificación) | Completo |
| **Recepciones + OC** | ❌ (stock entra por Inventario → Agregar) | ✅ |
| **Envíos** | ❌ (costo de envío manual en el POS) | ✅ |
| **Historial/Trazabilidad** | ❌ (movimientos en el tab Historial de Inventario) | ✅ |
| RRHH | Gate de plan existente (`puede_rrhh`), sin cambios | ídem |

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

## Pendiente

- **Deploy a PROD**: aplicar mig 207 ANTES del merge `dev → main` (deja PROD en avanzado, cero impacto) → PR → release.
- e2e smoke del modo básico (menor; requiere alternar el modo del tenant de test sin romper la suite avanzada).

## Links relacionados

- [[wiki/features/wms]]
- [[wiki/features/inventario-stock]]
- [[wiki/business/planes-pricing]]
- [[wiki/database/migraciones]]
