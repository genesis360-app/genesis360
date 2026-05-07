---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.0** ✅ · DEV = PROD ✅

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

## Estado actual (al cierre de sesión 2026-05-06)

- Migrations DEV+PROD: 001–088 ✅
- APP_VERSION en brand.ts: `v1.8.0`
- PR #104 mergeado · release v1.8.0 en GitHub ✅ · Vercel autodeploy en curso
- pg_cron activo DEV+PROD: `tn-stock-sync` + `meli-stock-sync` cada 5 min
- Edge Functions PROD: `data-api` · `emitir-factura` · `send-email` · `tn-stock-worker` ✅
- Sentry activo en PROD: `@sentry/react` + `VITE_SENTRY_DSN` en Vercel ✅
- Supabase Security Advisor: 80 → 7 warnings (7 aceptados by design) ✅
- `.claude/settings.json` → en `.gitignore`. El push con tokens fue bloqueado por GH Push Protection antes de llegar al remoto. Tokens NO expuestos.

---

## Lo producido en esta sesión (ya en PROD)

### v1.7.0 — API pull
- EF `data-api` (--no-verify-jwt): GET por entidad (productos/clientes/proveedores/inventario), json/csv, auth X-API-Key SHA-256, rate 120 req/min
- Migration 087: tabla `api_keys` con RLS (key_hash SHA-256, key_prefix para display, permisos TEXT[], activo, last_used_at)
- ConfigPage tab "API" (OWNER/ADMIN): generar key (plain text una sola vez), revocar, docs inline con entidades, params y curl
- Exportar JSON/CSV en ProductosPage, ClientesPage, ProveedoresPage (dropdown hover, BOM UTF-8)

### v1.8.0 — NC electrónicas + email CAE + fixes OC
- `send-email` tipo `factura_emitida`: email con tabla de ítems + badge CAE al cliente al emitir
- `emitir-factura`: fire-and-forget email + soporte NC-A/B/C via `devolucion_id` + guarda en `devoluciones`
- Migration 088: `devoluciones` + `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`, `nc_tipo`, `nc_punto_venta`
- VentasPage: badge `NC-B #000001` + botón "Emitir NC" en sección devoluciones del modal detalle
- GastosPage OC: medios de pago mixtos (N filas), fix CC bug, pagadas al fondo con expand de ítems
- ProveedoresPage: "Confirmar OC" bloqueado con `pago_parcial` — solo habilita `pagada` o `cuenta_corriente`

---

## Pendientes próximas sesiones

### Media prioridad
- **Notificación automática CC vencida** — pg_cron diario → INSERT en `notificaciones` para clientes con deuda vencida y OC vencidas sin pagar
- **OC → Gasto automático** al confirmar recepción en RecepcionesPage
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report

### Backlog
- WMS Fase 3 — tabla `wms_tareas` (putaway/picking/replenishment/conteo) + listas de picking con ruta óptima
- RecepcionesPage completa (schema ya existe en migrations 050+059, falta flujo UI completo)
- Sync catálogo TN/MELI (push nombre/precio/descripción hacia los marketplaces)
- Courier rates APIs reales (OCA/Andreani/CorreoAR)
- WhatsApp automático (espera WABA — WhatsApp Business API account)

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar $5 en console.anthropic.com para `scan-product` IA (Claude Haiku)
- Iniciar trámite constitución empresa para CUIT activo (bloquea AFIP en PROD real)
- Iniciar trámite Google Ads Standard Token (proceso manual largo, puede tardar meses)

---

## Referencias técnicas clave

### Migrations relevantes
- 083: `clientes.cuenta_corriente_habilitada` + `ventas.es_cuenta_corriente`
- 084: tabla `notificaciones` + caja_sesiones mejoras + Caja Fuerte
- 085: ordenes_compra pagos + proveedores CC + `proveedor_cc_movimientos` + `fn_saldo_proveedor_cc()`
- 086+086b: security hardening (REVOKE FROM PUBLIC + SET search_path) → 80→7 warnings
- 087: `api_keys` — API pull externa
- 088: NC electrónicas en `devoluciones`

### Supabase Security — 7 warnings aceptados
- Auth helpers (`is_admin`, `is_rrhh`, etc.) — retornan false para anon, sin riesgo
- `fn_crear_caja_fuerte` — trigger interno
- `pg_net` en public schema — Supabase managed, no modificable
- `planes` sin RLS — datos públicos by design
- `leaked_password_protection` — solo plan Pro

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- tipoCmp: A=1 · B=6 · C=11 · NC-A=3 · NC-B=8 · NC-C=13

### Supabase projects
- PROD: `jjffnbrdjchquexdfgwq`
- DEV: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
