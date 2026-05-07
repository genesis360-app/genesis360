# Log — Genesis360 Wiki

Log cronológico append-only. Cada entrada empieza con `## [YYYY-MM-DD] tipo | título`.

Tipos: `init` · `ingest` · `query` · `update` · `lint`

---

## [2026-05-06] update | Migración al SSD + consolidación docs — todo listo para compact

**Cambios de sesión (2026-05-06):**

### Migración de paths
- App movida: `E:\OneDrive\...\stockapp` → `D:\Dev\Genesis360` (SSD, fuera de OneDrive)
- Vault movido: `D:\Obsidian\boveda\Genesis360` → `D:\Dev\Genesis360\G360.Wiki` (dentro del repo)
- `npm install` ejecutado en nueva ubicación — build OK (`✓ built in 30.21s`)

### Consolidación de documentación
- `docs/` eliminado de la app — 8 archivos movidos a `G360.Wiki/sources/raw/`
- `G360.Wiki/CLAUDE.md` renombrado a `_schema.md` — evita confusión con CLAUDE.md de la app
- `Bienvenido.md` actualizado con nueva estructura y referencias
- `G360.Wiki/` commiteada en git (rama `dev`, commit `94b09930`)

### Paths actualizados
- `_schema.md`: código fuente apunta a `D:\Dev\Genesis360`
- Memory files: `project_genesis360.md` y `project_wiki_system.md` actualizados con nuevos paths y v1.6.0
- `index.md`: fuentes en raw/ documentadas

### Estado de cierre de sesión
- Versión PROD: v1.6.0 · 85 migraciones · 46 páginas wiki
- Sin pendientes en el wiki
- Listo para /clear o /compact

---

## [2026-05-06] update | Reestructura del vault — consolidación de fuentes

**Cambios estructurales:**
- `CLAUDE.md` renombrado a `_schema.md` — evita confusión con el CLAUDE.md de la app
- `Bienvenido.md` y `_schema.md` actualizados para reflejar el nuevo nombre y aclarar la diferencia
- `sources/raw/` poblado con los 8 archivos de `D:\Dev\Genesis360\docs/`:
  - `arquitectura_escalabilidad.md`
  - `reglas_negocio.md`
  - `uat.md`
  - `genesis360_overview.html`, `soporte_*.html` (×4)
- `index.md` actualizado con la tabla de fuentes
- `D:\Dev\Genesis360\docs/` se mantiene en la app (fuente original, no se borró)

**Regla de flujo confirmada:**
- Desarrollo → actualizar `CLAUDE.md` / `ROADMAP.md` en `D:\Dev\Genesis360\`
- Al terminar sesión → pedir "actualizá el wiki" → Claude sincroniza las páginas relevantes
- Consulta → abrir Obsidian en `G360.Wiki/`

Para ver las últimas 5 entradas: `grep "^## \[" log.md | tail -5`

---

## [2026-05-05] update | v1.5.0 + v1.6.0 — Notificaciones, Caja Fuerte, PDF AFIP, OC pagos, CC Proveedores

**Versiones detectadas como nuevas:** v1.5.0 (migration 084) y v1.6.0 (migration 085).  
**Fuentes leídas:** CLAUDE.md (líneas 1395-1441) + ROADMAP.md (encabezado + secciones v1.5.0/v1.6.0).

**Páginas actualizadas:**
- `wiki/features/facturacion-afip.md` — recreada (estaba en 0 bytes) + PDF con QR AFIP v1.5.0 ✅
- `wiki/features/caja.md` — diferencia apertura inline, Tab Caja Fuerte, Tab Configuración, getTipoDisplay, historial sesiones
- `wiki/features/alertas.md` — nuevas secciones OC vencidas (rojo) y próximas ≤3d (ámbar), badge actualizado
- `wiki/features/gastos.md` — Tab "Órdenes de Compra" con modal pago/CC, badges contextuales
- `wiki/features/clientes-proveedores.md` — pago CC inline FIFO + módulo CC Proveedores completo
- `wiki/business/roadmap.md` — v1.5.0 + v1.6.0 completos, versión actualizada a v1.6.0
- `wiki/database/migraciones.md` — migrations 084 + 085
- `wiki/overview/genesis360-overview.md` — v1.4.0 → v1.6.0, 83 → 85 migraciones, notificaciones en módulos

**Páginas nuevas:**
- `wiki/features/notificaciones.md` — módulo completamente nuevo: tabla, campana, email, diferencia caja

**Estado final:** 46 páginas · 85 migraciones documentadas · v1.6.0

---

## [2026-05-01] update | Wiki completo — sin pendientes

**Acción:** Finalización completa del wiki. Todas las páginas actualizadas, 6 páginas nuevas desde docs/.

**Páginas actualizadas (thin → completas):**
- `wiki/features/ventas-pos.md` — 3 modos, pago parcial, combos, CC, multi-LPN, scanner, carrito draft, QR MP
- `wiki/features/inventario-stock.md` — Sprints A/B/C/D, autorizaciones DEPOSITO, conteos, masivo inline, LPN madre
- `wiki/integrations/mercado-pago.md` — preapproval model, QR ventas, add-on, routing webhook, IDs PROD
- `wiki/overview/genesis360-overview.md` — v1.4.0, tabla módulos completa, arquitectura actualizada

**Páginas nuevas desde docs/:**
- `wiki/architecture/escalabilidad.md` — costos, capacidad escala, cola jobs, workers, Sentry, cloud
- `wiki/architecture/pwa-config.md` — Service Worker, WASM, SPA routing Vercel
- `wiki/development/reglas-negocio.md` — reglas relevadas con GO (caja, ventas, inventario) + UAT
- `wiki/business/mercado-objetivo.md` — SMB/mid-market LatAm, posicionamiento vs Blue Yonder
- `wiki/business/roadmap.md` — ya existía, sin cambios
- `wiki/integrations/resend-email.md` — ya existía, sin cambios

**Fuentes procesadas en total:**
- CLAUDE.md (1.461 líneas)
- ROADMAP.md (490 líneas)
- WORKFLOW.md (172 líneas)
- README.md (150 líneas)
- docs/arquitectura_escalabilidad.md (163 líneas)
- docs/reglas_negocio.md (335 líneas)
- docs/uat.md (196 líneas)

**Estado final:** 44 páginas wiki · 83 migraciones documentadas · v1.4.0 · sin pendientes

---

## [2026-05-01] update | Poblado completo desde CLAUDE.md + ROADMAP.md + WORKFLOW.md

**Acción:** Lectura completa de los 4 archivos de documentación de la app (1461 líneas CLAUDE.md, 490 ROADMAP.md, 172 WORKFLOW.md, 150 README.md) y creación masiva de páginas wiki.

**Páginas creadas/actualizadas:**
- `wiki/integrations/mercado-libre.md` — OAuth, mapeo, webhooks, sync worker, items OMNI
- `wiki/integrations/tienda-nube.md` — OAuth, webhooks, tn-stock-worker, BATCH_SIZE 200
- `wiki/features/facturacion-afip.md` — AfipSDK, tipos A/B/C, FacturacionPage 4 tabs, homologación confirmada
- `wiki/features/rrhh.md` — 5 fases completas con schema, funciones SQL, UI
- `wiki/features/caja.md` — sesiones, tipos de movimiento, multi-caja, traspasos, arqueos
- `wiki/features/gastos.md` — variables, fijos, IVA, comprobantes, múltiples medios
- `wiki/features/devoluciones.md` — serializado/no-serializado, NC, rollback, caja
- `wiki/features/wms.md` — fases 1-4, KITs, conteos, recepciones/ASN, mono-SKU
- `wiki/features/clientes-proveedores.md` — CRM, CC, domicilios, OC, servicios
- `wiki/features/envios.md` — estados, remito PDF, WhatsApp Click-to-Chat
- `wiki/features/autenticacion-onboarding.md` — OAuth, roles, session timeout, Mi Cuenta
- `wiki/features/marketplace.md` — API pública, webhook, rate limiting
- `wiki/architecture/estado-global.md` — authStore, useSucursalFilter, usePlanLimits, hooks
- `wiki/database/migraciones.md` — 83 migraciones con descripción (001-083)
- `wiki/development/testing.md` — 154+ unit tests, 14 archivos E2E, todos los roles
- `wiki/development/convenciones-codigo.md` — reglas, patterns, TypeScript, RLS
- `wiki/development/supabase-dev-vs-prod.md` — flujo completo, secrets, pg_cron
- `wiki/business/roadmap.md` — historial v0.26–v1.4.0, backlog detallado
- `index.md` — actualizado con todas las páginas y estados

**Estado del proyecto confirmado:** v1.4.0 en PROD · 83 migraciones · 154+ unit tests

---

## [2026-04-30] init | Wiki inicializado desde exploración del código fuente

**Acción:** Inicialización completa del wiki Genesis360.

**Qué se hizo:**
- Exploración del código fuente en `E:\OneDrive\Documentos\01_Gastón\04_Emprendimientos\04_StockApp\stockapp\stockapp`
- Creación de `CLAUDE.md` (schema y reglas del wiki)
- Creación de `index.md` (catálogo inicial de páginas)
- Creación de estructura de carpetas: `sources/`, `wiki/` y subcarpetas
- Creación de página de overview principal
- Creación de páginas de arquitectura, features y development

**Estado del proyecto al momento de la inicialización:**
- Versión activa en producción
- 83 migraciones de DB
- 26 Edge Functions
- ~80 archivos TypeScript/TSX
- Planes: Free / Basic ($4.900 ARS) / Pro ($9.900 ARS) / Enterprise

**Páginas creadas en este init:**
- `wiki/overview/genesis360-overview.md`
- `wiki/architecture/frontend-stack.md`
- `wiki/architecture/backend-supabase.md`
- `wiki/architecture/multi-tenant-rls.md`
- `wiki/architecture/edge-functions.md`
- `wiki/features/inventario-stock.md`
- `wiki/features/ventas-pos.md`
- `wiki/features/suscripciones-planes.md`
- `wiki/development/workflow-git.md`
- `wiki/development/deploy.md`
- `wiki/database/schema-overview.md`
- `wiki/integrations/mercado-pago.md`
