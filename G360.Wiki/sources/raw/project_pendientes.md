---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.3** ✅ · DEV: **v1.8.3** ✅

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

## Estado actual (al cierre de sesión 2026-05-07)

- Migrations DEV: 001–092 ✅
- Migrations PROD: 001–092 ✅
- APP_VERSION en brand.ts: `v1.8.3`
- pg_cron activo DEV+PROD: `tn-stock-sync` + `meli-stock-sync` cada 5 min
- Edge Functions PROD: `data-api` · `emitir-factura` · `send-email` · `tn-stock-worker` ✅
- Sentry activo en PROD ✅
- Supabase Security Advisor: 7 warnings aceptados by design ✅

---

## Lo producido hoy (en DEV, pendiente PR → PROD)

### Fixes
- **Banner DEV**: `h-4 text-[10px]` (~25% más fino) + `mt-4` en AppLayout → no tapa header/sidebar
- **ProveedoresPage — badge estado_pago en OC**: cards de OC ahora muestran tag rojo/ámbar/azul según estado de pago (pendiente, parcial, CC, vencida)
- **EnviosPage — botón WhatsApp**: faltaba `telefono` en el select de `clientes` → "El cliente no tiene teléfono" aunque tuviera

### Features nuevas
- **Módulo Recursos** (migration 089): patrimonio del negocio. 2 tabs (Patrimonio / Por adquirir), CRUD, stats valor patrimonial + presupuesto estimado, alertas garantía, CTA cotizar con proveedor. Sidebar: Landmark icon, ownerOnly.
- **Estructura de embalaje en ingreso de stock**: InventarioPage modal ingreso + RecepcionesPage por ítem — select que carga estructuras del producto, preselecciona la default, guarda `estructura_id` en `inventario_lineas`.

### Housekeeping
- CLAUDE.md: reducido de ~1500 a ~120 líneas. Solo contexto operacional. Reglas wiki obligatorias.
- Wiki: roadmap actualizado con v1.7.0 + v1.8.0 + v1.8.1. Unicidad de docs en wiki.

---

## Pendientes próximas sesiones

### Alta prioridad
- ✅ **Multi-sucursal: filtrado estricto** — implementado 2026-05-07. Ver `wiki/features/multi-sucursal.md`

### Media prioridad
- ✅ **OC → Gasto automático** — migration 090 (`recepcion_id` en `gastos`) + RecepcionesPage crea gasto al confirmar
- ✅ **Notificación automática CC vencida** — migration 091: `fn_notificar_cc_vencidas()` + pg_cron diario 09:00 AR
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report
- **Asistente IA en header** — chat contextual en la barra superior (ícono de ayuda): responde preguntas sobre funciones de la app, guía al usuario por módulos, ayuda a reportar problemas (recopila info del error y lo envía como bug-report). Modelo sugerido: Claude Haiku (bajo costo, respuesta rápida). Contexto del sistema: documentación de la app + módulo activo actual.

### Roadmap APIs — plan completo documentado en `wiki/integrations/roadmap-apis.md`

**Fase 1** (quick wins sobre infra existente — pausada, lista para implementar):
- MELI Rentabilidad Neta Real (extender meli-webhook, leer comisiones/envío/impuestos)
- MercadoPago Conciliación automática (split comisión/retenciones IIBB en gastos)
- TiendaNube BOM automático para combos (descontar componentes al pagar kit)
- AFIP Auto-completado CUIT → Razón Social/IVA/Domicilio desde WS ARCA
- MELI Repricing automático por margen

**Fase 2**: PagoNube + EnvíoNube (ambos: operaciones propias + checkout TiendaNube)
**Fase 3**: Logística directa (Andreani/OCA/CorreoAR) — rate shopping, etiquetas, RMA
**Fase 4**: MELI Ads — ACOS, auto-pausado por margen, inversión atada a stock
**Fase 5**: Meta Ads + POAS + GA4 UTM + Google Ads (posicionamiento futuro)
**Fase 6**: Email Marketing (Brevo/Klaviyo RFM) + WhatsApp Cloud API (espera WABA account)

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

### Multi-sucursal — estado actual del código
- `useSucursalFilter.applyFilter`: `.eq('sucursal_id', sucursalId)` estricto ✅
- `authStore`: `sucursalId: string | null` — null = vista global. Sentinel `'__global__'` en localStorage ✅
- Tablas con `sucursal_id`: inventario_lineas, movimientos_stock, ventas, caja_sesiones, gastos, clientes
- `SucursalSelector` en header: opción "Todas las sucursales" agregada ✅

### Supabase projects
- PROD: `jjffnbrdjchquexdfgwq`
- DEV: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- tipoCmp: A=1 · B=6 · C=11 · NC-A=3 · NC-B=8 · NC-C=13
