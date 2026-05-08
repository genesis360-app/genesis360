---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.3** ✅ · DEV: **v1.8.4** (pendiente PR → PROD)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

## Estado actual (al cierre de sesión 2026-05-08)

- Migrations DEV: 001–092 ✅
- Migrations PROD: 001–092 ✅
- APP_VERSION en brand.ts: `v1.8.4`
- pg_cron activo DEV+PROD: `tn-stock-sync` + `meli-stock-sync` cada 5 min + `notif-cc-vencidas` diario 09:00 AR
- Edge Functions DEV: agrega `ai-assistant` (Groq/Llama 3.1, GROQ_API_KEY configurada en DEV ✅)
- Edge Functions PROD: `data-api` · `emitir-factura` · `send-email` · `tn-stock-worker` (falta `ai-assistant`)
- Sentry activo en PROD ✅
- Supabase Security Advisor: 7 warnings aceptados by design ✅

---

## Lo producido en sesión 2026-05-07/08 (en DEV — v1.8.4 pendiente PR → PROD)

- **Multi-sucursal filtrado estricto**: `useSucursalFilter` → `.eq()` estricto. Opción "Todas las sucursales" en header. Sentinel `__global__` en localStorage.
- **OC → Gasto automático**: migration 090 (`recepcion_id` en gastos) + RecepcionesPage crea gasto al confirmar.
- **Notificaciones CC vencidas**: migration 091 + `fn_notificar_cc_vencidas()` + pg_cron 09:00 AR.
- **Productos — precios mayoristas**: migration 092 (`producto_precios_mayorista`) + toggle tiers en ProductoFormPage.
- **Productos — mass update expandido**: bulk precio (% o fijo), proveedor, reactivar.
- **Asistente IA en header**: EF `ai-assistant` (Groq free tier) + `AiAssistant.tsx` + template bug_report en send-email.
- **Roadmap APIs documentado**: 6 fases en `wiki/integrations/roadmap-apis.md` (pausado, listo para retomar).

---

## Para mañana — prioridad 1 (arrancar por acá)

### 1. Deploy v1.8.4 a PROD
Antes de cualquier otra cosa:
- PR `dev → main` v1.8.4
- Deploy EF `ai-assistant` en PROD
- **Configurar secret `GROQ_API_KEY` en PROD** (project `jjffnbrdjchquexdfgwq`) — sin esto el asistente no funciona en PROD
- GitHub release v1.8.4

### 2. Mejora asistente IA — system prompt preciso
El prompt actual describe la UI de manera genérica e incorrecta. Reescribir con:
- Navegación: **sidebar izquierdo** (no "barra superior"). Ítems: Dashboard, Inventario, Productos, Ventas, Clientes, Proveedores, Recepciones, Gastos, Caja, Envíos, Recursos, Configuración.
- Nombres exactos de botones por módulo (ej: "Agregar Stock" no "Ingresar", "Nueva venta" no "Crear venta")
- Ubicación real de acciones (esquina superior derecha del listado, panel expandido, modal, etc.)
- A futuro: evaluar inyectar screenshots como contexto visual

### 3. Multi-sucursal — expandir filtro a todos los módulos operativos ✅ COMPLETO
**Regla**: catálogo base (productos, categorías, proveedores) = global. Todo lo operativo = filtra por sucursal activa.

| Módulo | Estado | Qué hacer |
|---|---|---|
| InventarioPage | ✅ | — |
| MovimientosPage | ✅ | — |
| VentasPage | ✅ | — |
| GastosPage | ✅ | — |
| CajaPage | ✅ | — |
| **ProductosPage — stock crítico** | ✅ | `applyFilter` en query de `inventario_lineas` — badge y disponible filtran por sucursal. |
| **RecepcionesPage — listado** | ✅ | `applyFilter` en query del listado. |
| **EnviosPage — listado** | ✅ | Ya tenía `applyFilter` correctamente implementado. |
| **RecursosPage — listado** | ✅ | Ya tenía `applyFilter` correctamente implementado. |
| Notificaciones campana | — | Evaluar si alertas de stock deben filtrarse por sucursal del user |
| RRHH | — | Verificar si existe módulo y si tiene `sucursal_id` |

Ver detalle en `wiki/features/multi-sucursal.md`.

---

## Backlog — próximas sesiones

### Media prioridad
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report

### Roadmap APIs (pausado — ver `wiki/integrations/roadmap-apis.md`)
- **Fase 1**: MELI rentabilidad neta · MP conciliación automática · TN BOM combos · AFIP autocomplete CUIT · MELI repricing
- **Fase 2**: PagoNube + EnvíoNube (operaciones propias + checkout TiendaNube)
- **Fase 3**: Logística directa (Andreani/OCA) — rate shopping, etiquetas, RMA
- **Fase 4**: MELI Ads — ACOS, auto-pausado por margen
- **Fase 5**: Meta Ads + POAS + GA4 (posicionamiento futuro)
- **Fase 6**: WhatsApp Cloud API (espera WABA) + Brevo/Klaviyo RFM

### Backlog técnico
- WMS Fase 3 — `wms_tareas` (putaway/picking/replenishment) + listas de picking con ruta óptima

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)

---

## Referencias técnicas clave

### Migrations relevantes
- 083: `clientes.cuenta_corriente_habilitada` + `ventas.es_cuenta_corriente`
- 084: tabla `notificaciones` + caja_sesiones mejoras + Caja Fuerte
- 085: ordenes_compra pagos + proveedores CC + `proveedor_cc_movimientos`
- 086+086b: security hardening → 80→7 warnings
- 087: `api_keys` — API pull externa
- 088: NC electrónicas en `devoluciones`
- 089: `recursos` — patrimonio del negocio
- 090: `gastos.recepcion_id` — trazabilidad OC→Gasto
- 091: `fn_notificar_cc_vencidas()` + pg_cron diario
- 092: `producto_precios_mayorista` — tiers precio mayorista

### Multi-sucursal — estado actual del código
- `useSucursalFilter.applyFilter`: `.eq('sucursal_id', sucursalId)` estricto ✅
- `authStore`: `sucursalId: string | null` — null = vista global. Sentinel `'__global__'` en localStorage ✅
- Tablas con `sucursal_id`: inventario_lineas, movimientos_stock, ventas, caja_sesiones, gastos, clientes, recepciones, recursos, envios (verificar)
- Filtro PENDIENTE en: ProductosPage (stock crítico), RecepcionesPage, EnviosPage, RecursosPage

### Asistente IA
- EF `ai-assistant`: Groq API, modelo `llama-3.1-8b-instant`, auth JWT, free tier 14.400 req/día
- Secret `GROQ_API_KEY`: DEV ✅ · PROD ❌ (configurar al deployar v1.8.4)
- Componente: `src/components/AiAssistant.tsx` — panel chat, acciones rápidas, flujo bug report
- Mejora pendiente: reescribir system prompt con mapa exacto de UI (sidebar, botones literales)

### Supabase projects
- PROD: `jjffnbrdjchquexdfgwq`
- DEV: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- tipoCmp: A=1 · B=6 · C=11 · NC-A=3 · NC-B=8 · NC-C=13
