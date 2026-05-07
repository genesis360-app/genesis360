---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---
Último release en PROD: **v1.6.1** ✅ · DEV adelantado con v1.7.0 (pendiente PR → PROD)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

## Estado actual

- v1.6.1 en PROD ✅
- v1.7.0 en DEV (en curso, pendiente PR → PROD)
- Migrations DEV: 001–087 ✅ · PROD: 001–086b ✅
- APP_VERSION en brand.ts: `v1.6.1` (bump a v1.7.0 al deployar)
- pg_cron activo DEV+PROD: `tn-stock-sync` + `meli-stock-sync` cada 5 min
- Edge Functions DEV+PROD: `tn-stock-worker` · `send-email` · `emitir-factura`
- Sentry activo en PROD: `@sentry/react` + `VITE_SENTRY_DSN` en Vercel ✅
- Supabase Security Advisor: 80 → 7 warnings ✅
- npm audit: 21 → 7 vulnerabilidades (7 aceptadas) ✅

---

## Lo nuevo en v1.8.0 (DEV ✅ · PROD pendiente deploy)

### Email al cliente al emitir CAE
- Template `factura_emitida` en EF `send-email`: asunto con tipo+número, tabla de ítems, total, badge verde con CAE y fecha vencimiento.
- EF `emitir-factura`: fetch `email` del cliente en el select. Fire-and-forget `send-email` tras guardar CAE (solo en facturas, no NC).

### Notas de Crédito electrónicas (migration 088)
- **Migration 088**: `devoluciones` + `nc_cae TEXT`, `nc_vencimiento_cae TEXT`, `nc_numero_comprobante INT`, `nc_tipo CHECK(NC-A/NC-B/NC-C)`, `nc_punto_venta INT`. Índice en `nc_cae`.
- **EF `emitir-factura` ampliada**: acepta `tipo_comprobante: NC-A|NC-B|NC-C` + `devolucion_id`. Usa ítems de `devolucion_items`. Guarda CAE en `devoluciones` (no en `ventas`). Valida que venta tenga CAE original y que la NC no esté duplicada.
- **VentasPage**: en sección Devoluciones del modal detalle — badge verde si ya tiene NC (`NC-B #000001`); botón azul "Emitir NC" si la venta tiene CAE y `facturacion_habilitada=true` y la devolución aún no tiene NC. Modal con selector NC-A/B/C + punto de venta.

---

## Lo nuevo en v1.7.0 (DEV ✅ · PROD pendiente deploy)

### API pull — acceso externo a datos
- **Migration 087** (`api_keys`): `id, tenant_id, nombre, key_prefix, key_hash, permisos TEXT[], activo, last_used_at`. RLS tenant. Índices en `key_hash` y `(tenant_id, activo)`.
- **EF `data-api`** (`--no-verify-jwt`): `GET /data-api?entity=...&format=json|csv&limit&offset&updated_since&sucursal_id`. Entidades: productos / clientes / proveedores / inventario. Auth: `X-API-Key: g360_xxx` (hash SHA-256). Rate limit 120 req/min en memoria. BOM UTF-8 en CSV.
- **ConfigPage → tab "API"** (OWNER/ADMIN): CRUD de keys (generar → mostrar plain key una sola vez → copiar → revocar), tabla con `key_prefix•••`, `last_used_at`, estado activa/revocada. Documentación inline con tabla de entidades, parámetros y ejemplo curl.
- **Botones Exportar JSON/CSV**: dropdown `group-hover` en header de ProductosPage (`filtered`), ClientesPage (`clientes`), ProveedoresPage (`filteredProv`). BOM UTF-8 para Excel AR. Función pura `exportar*` local por página.

---

## Pendientes próximas sesiones

### Alta prioridad
- **Deploy v1.7.0 + v1.8.0 a PROD** — migrations 087+088 · EF `data-api --no-verify-jwt` · EF `emitir-factura` · EF `send-email` · bump APP_VERSION v1.8.0 · PR + release

### Media prioridad
- **Notificación automática CC vencida** — pg_cron diario para clientes y proveedores
- **OC → Gasto automático** al confirmar recepción
- **Centro de Soporte `/ayuda`** — plan completo en CLAUDE.md

### Backlog
- Sync catálogo TN/MELI (push nombre/precio/descripción)
- Courier rates APIs reales (OCA/Andreani/CorreoAR)
- WhatsApp automático (espera WABA)
- WMS Fase 3 — wms_tareas + picking
- RecepcionesPage completa (schema ya existe en migrations 050+059)

### Pendiente manual (no código)
- Activar Dependabot en GitHub Settings (monitorear PRs automáticos)
- Verificar genesis360.pro en Resend → cambiar FROM a noreply@genesis360.pro
- Cargar $5 en console.anthropic.com para scan-product IA
- Iniciar trámite constitución empresa para CUIT activo
- Iniciar trámite Google Ads Standard Token (proceso largo)

---

## Referencias técnicas clave

### Migrations
- 085: ordenes_compra pagos + proveedores CC + proveedor_cc_movimientos
- 086: SET search_path + REVOKE FROM anon
- 086b: REVOKE FROM PUBLIC + GRANT TO authenticated (corrección definitiva)
- 087: api_keys (DEV ✅, PROD pendiente)

### Supabase Security — 7 warnings restantes aceptados
- Auth helpers (is_admin, is_rrhh, etc.) — anon warning: safe, retornan false para auth.uid()=null
- fn_crear_caja_fuerte — trigger interno
- pg_net en public schema — Supabase managed
- planes sin RLS — datos públicos by design
- leaked_password_protection — solo plan Pro

### API v1.7.0 — deploy checklist
1. `supabase db push --project-ref gcmhzdedrkmmzfzfveig` (ya debería estar)
2. `supabase db push --project-ref jjffnbrdjchquexdfgwq` (PROD)
3. `supabase functions deploy data-api --project-ref jjffnbrdjchquexdfgwq --no-verify-jwt`
4. Bump `APP_VERSION` a `v1.7.0` en `brand.ts`
5. PR dev → main · GitHub release v1.7.0

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → URL afip.gob.ar/fe/qr
- tipoCmp: A=1, B=6, C=11
